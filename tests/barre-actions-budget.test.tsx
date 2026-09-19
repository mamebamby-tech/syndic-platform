// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { chargerMessages } from "@/lib/i18n/messages";
import { confirmerSortie, definirModificationsNonEnregistrees } from "@/lib/garde-sortie";

// Les actions serveur importent cookies et Supabase : hors sujet pour un rendu.
vi.mock("@/app/immeubles/[immeubleId]/budget/actions", () => ({
  enregistrerBudget: async () => undefined,
  genererAppels: async () => undefined,
  enregistrerEtGenererAppels: async () => undefined,
}));

const { BarreActionsBudget } = await import("@/components/budget/barre-actions-budget");
const messages = await chargerMessages("fr");

// Ce que la page rend : la table (côté serveur) dont les champs se rattachent au
// formulaire #budget-form, et la barre d'actions.
function Page({ verrouille = false }: { verrouille?: boolean }) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="UTC">
      <form id="budget-form" />
      <input form="budget-form" name="montant:p1" type="number" defaultValue={450000} aria-label="montant 1" />
      <input form="budget-form" name="montant:p2" type="number" defaultValue={0} aria-label="montant 2" />
      <input form="budget-form" name="fournisseur:p1" type="text" defaultValue="" aria-label="fournisseur 1" />
      <input form="budget-form" type="hidden" name="posteIds" defaultValue="p1,p2" />
      <a href="https://exemple.test/lots">Registre</a>
      <BarreActionsBudget verrouille={verrouille} />
    </NextIntlClientProvider>
  );
}

const bouton = (nom: RegExp) => screen.getByRole("button", { name: nom }) as HTMLButtonElement;
const saisir = (libelle: string, valeur: string) =>
  fireEvent.input(screen.getByLabelText(libelle), { target: { value: valeur } });

afterEach(() => {
  cleanup();
  definirModificationsNonEnregistrees(false);
  vi.restoreAllMocks();
});

describe("budget — génération et modifications non enregistrées", () => {
  it("sans modification : générer est possible, enregistrer n'a rien à faire, aucun message", async () => {
    render(<Page />);
    expect(bouton(/Générer les appels de cette période/).disabled).toBe(false);
    expect(bouton(/^Enregistrer le budget$/).disabled).toBe(true);
    expect(bouton(/Enregistrer et générer/).disabled).toBe(false);
    expect(screen.queryByText(/Enregistrez le budget avant de générer les appels/)).toBeNull();
  });

  it("dès qu'un montant est modifié : générer est désactivé, avec le message demandé", () => {
    render(<Page />);
    saisir("montant 2", "12000");
    expect(bouton(/Générer les appels de cette période/).disabled).toBe(true);
    expect(screen.getByText(/Enregistrez le budget avant de générer les appels/)).toBeTruthy();
    expect(bouton(/^Enregistrer le budget$/).disabled).toBe(false);
  });

  it("le message dit exactement « Enregistrez le budget avant de générer les appels »", () => {
    render(<Page />);
    saisir("montant 1", "1");
    expect(document.getElementById("raison-generation")!.textContent).toContain(
      "Enregistrez le budget avant de générer les appels",
    );
  });

  it("le bouton désactivé est relié à son explication (accessibilité)", () => {
    render(<Page />);
    saisir("montant 1", "1");
    expect(bouton(/Générer les appels de cette période/).getAttribute("aria-describedby")).toBe("raison-generation");
  });

  it("une modification du fournisseur compte aussi", () => {
    render(<Page />);
    saisir("fournisseur 1", "Nouveau fournisseur");
    expect(bouton(/Générer les appels de cette période/).disabled).toBe(true);
  });

  it("revenir à la valeur enregistrée réactive la génération", () => {
    render(<Page />);
    saisir("montant 1", "1");
    expect(bouton(/Générer les appels de cette période/).disabled).toBe(true);
    saisir("montant 1", "450000");
    expect(bouton(/Générer les appels de cette période/).disabled).toBe(false);
    expect(screen.queryByText(/Enregistrez le budget avant/)).toBeNull();
  });

  it("« Enregistrer et générer » reste disponible avec des modifications : c'est l'action unique", () => {
    render(<Page />);
    saisir("montant 1", "1");
    expect(bouton(/Enregistrer et générer/).disabled).toBe(false);
  });

  it("budget verrouillé (appels émis) : on ne peut ni enregistrer ni enregistrer-et-générer", () => {
    render(<Page verrouille />);
    saisir("montant 1", "1");
    expect(bouton(/^Enregistrer le budget$/).disabled).toBe(true);
    expect(bouton(/Enregistrer et générer/).disabled).toBe(true);
  });

  it("les trois boutons soumettent le même formulaire, chacun avec sa propre action", () => {
    render(<Page />);
    for (const nom of [/^Enregistrer le budget$/, /Générer les appels de cette période/, /Enregistrer et générer/]) {
      expect(bouton(nom).getAttribute("form")).toBe("budget-form");
      expect(bouton(nom).type).toBe("submit");
    }
  });
});

describe("budget — prévenir avant de quitter avec des modifications non enregistrées", () => {
  const fermer = () => {
    const evenement = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(evenement);
    return evenement.defaultPrevented;
  };

  it("fermeture ou rechargement : le navigateur est prévenu s'il y a des modifications", () => {
    render(<Page />);
    expect(fermer()).toBe(false);
    saisir("montant 1", "1");
    expect(fermer()).toBe(true);
  });

  it("plus d'avertissement une fois revenu à l'état enregistré", () => {
    render(<Page />);
    saisir("montant 1", "1");
    saisir("montant 1", "450000");
    expect(fermer()).toBe(false);
  });

  it("clic sur un lien avec des modifications : confirmation demandée ; refusée, la navigation est annulée", () => {
    const confirmer = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page />);
    saisir("montant 1", "1");
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByText("Registre").dispatchEvent(clic);
    expect(confirmer).toHaveBeenCalledWith(
      "Des modifications du budget ne sont pas enregistrées. Quitter cette page les perdra.",
    );
    expect(clic.defaultPrevented).toBe(true);
  });

  it("clic sur un lien, confirmation acceptée : la navigation se poursuit", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Page />);
    saisir("montant 1", "1");
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByText("Registre").dispatchEvent(clic);
    expect(clic.defaultPrevented).toBe(false);
  });

  it("sans modification, un clic sur un lien ne demande rien", () => {
    const confirmer = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page />);
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByText("Registre").dispatchEvent(clic);
    expect(confirmer).not.toHaveBeenCalled();
    expect(clic.defaultPrevented).toBe(false);
  });

  it("la garde est retirée quand on quitte la page (démontage) : pas d'avertissement fantôme", () => {
    const { unmount } = render(<Page />);
    saisir("montant 1", "1");
    expect(fermer()).toBe(true);
    unmount();
    expect(fermer()).toBe(false);
    expect(confirmerSortie("x")).toBe(true);
  });

  it("le sélecteur d'immeuble passe par confirmerSortie : refus = on reste, acceptation = on part", () => {
    const confirmer = vi.spyOn(window, "confirm");
    expect(confirmerSortie("x")).toBe(true);
    expect(confirmer).not.toHaveBeenCalled();
    definirModificationsNonEnregistrees(true);
    confirmer.mockReturnValueOnce(false);
    expect(confirmerSortie("x")).toBe(false);
    confirmer.mockReturnValueOnce(true);
    expect(confirmerSortie("x")).toBe(true);
  });
});
