"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { creerClientNavigateur } from "@/lib/supabase/client";

type Mode = "email" | "telephone";
type Etape = "identifiant" | "code";

function estEmail(valeur: string) {
  return valeur.includes("@");
}

export function FormulaireConnexion() {
  const router = useRouter();
  const supabase = creerClientNavigateur();

  const [mode, setMode] = useState<Mode>("email");
  const [etape, setEtape] = useState<Etape>("identifiant");
  const [identifiant, setIdentifiant] = useState("");
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyerCode(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);

    const { error } =
      mode === "email"
        ? await supabase.auth.signInWithOtp({ email: identifiant })
        : await supabase.auth.signInWithOtp({ phone: identifiant });

    setEnCours(false);
    if (error) {
      setErreur(error.message);
      return;
    }
    setEtape("code");
  }

  async function verifierCode(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);

    const { error } =
      mode === "email"
        ? await supabase.auth.verifyOtp({
            email: identifiant,
            token: code,
            type: "email",
          })
        : await supabase.auth.verifyOtp({
            phone: identifiant,
            token: code,
            type: "sms",
          });

    setEnCours(false);
    if (error) {
      setErreur(error.message);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-card border border-filet bg-surface p-8">
      <h1 className="mb-1 text-2xl text-encre">Connexion</h1>
      <p className="mb-6 text-sm text-encre-2">
        Aucun mot de passe. Un code à usage unique confirme votre identité.
      </p>

      {etape === "identifiant" && (
        <form onSubmit={envoyerCode} className="space-y-4">
          <div className="flex gap-1 rounded-control border border-filet p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode("email");
                setIdentifiant("");
              }}
              className={`flex-1 rounded-[6px] py-1.5 transition-colors ${
                mode === "email"
                  ? "bg-action-doux text-action-encre"
                  : "text-encre-2"
              }`}
            >
              Adresse électronique
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("telephone");
                setIdentifiant("");
              }}
              className={`flex-1 rounded-[6px] py-1.5 transition-colors ${
                mode === "telephone"
                  ? "bg-action-doux text-action-encre"
                  : "text-encre-2"
              }`}
            >
              Téléphone
            </button>
          </div>

          <div>
            <label
              htmlFor="identifiant"
              className="mb-1 block text-sm text-encre-2"
            >
              {mode === "email" ? "Adresse électronique" : "Numéro de téléphone"}
            </label>
            <input
              id="identifiant"
              name="identifiant"
              type={mode === "email" ? "email" : "tel"}
              required
              autoComplete={mode === "email" ? "email" : "tel"}
              placeholder={mode === "email" ? "vous@exemple.com" : "+221 77 000 00 00"}
              value={identifiant}
              onChange={(evenement) => setIdentifiant(evenement.target.value)}
              className="h-11 w-full rounded-control border border-filet bg-surface px-3 text-encre outline-none focus:border-action"
            />
          </div>

          {erreur && <p className="text-sm text-impaye">{erreur}</p>}

          <button
            type="submit"
            disabled={enCours || identifiant.length === 0}
            className="h-11 w-full rounded-control bg-action text-white transition-opacity disabled:opacity-50"
          >
            {enCours ? "Envoi…" : "Recevoir le code"}
          </button>
        </form>
      )}

      {etape === "code" && (
        <form onSubmit={verifierCode} className="space-y-4">
          <p className="text-sm text-encre-2">
            Code envoyé {estEmail(identifiant) ? "par courriel" : "par SMS"} à{" "}
            <span className="text-encre">{identifiant}</span>.
          </p>

          <div>
            <label htmlFor="code" className="mb-1 block text-sm text-encre-2">
              Code à usage unique
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(evenement) => setCode(evenement.target.value)}
              className="h-11 w-full rounded-control border border-filet bg-surface px-3 text-center text-lg tabular-nums tracking-[0.3em] text-encre outline-none focus:border-action"
            />
          </div>

          {erreur && <p className="text-sm text-impaye">{erreur}</p>}

          <button
            type="submit"
            disabled={enCours || code.length === 0}
            className="h-11 w-full rounded-control bg-action text-white transition-opacity disabled:opacity-50"
          >
            {enCours ? "Vérification…" : "Se connecter"}
          </button>

          <button
            type="button"
            onClick={() => {
              setEtape("identifiant");
              setCode("");
              setErreur(null);
            }}
            className="w-full text-sm text-encre-2 underline underline-offset-2"
          >
            Changer d&apos;adresse ou de numéro
          </button>
        </form>
      )}
    </div>
  );
}
