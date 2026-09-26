import { creerClientServeur } from "@/lib/supabase/server";
import { DocumentAbsent, DocumentAltere, lireDocumentAppel } from "@/lib/appels/document-pdf";

// Sert le PDF ENREGISTRÉ de l'appel (décision 69), jamais un PDF reconstruit.
// La sécurité par ligne et les politiques du seau décident qui peut le lire.
export async function GET(_requete: Request, { params }: { params: Promise<{ immeubleId: string; appelId: string }> }) {
  const { appelId } = await params;
  const supabase = await creerClientServeur();
  const { data: appel } = await supabase.from("appels").select("reference").eq("id", appelId).maybeSingle();
  if (!appel) return new Response(null, { status: 404 });
  try {
    const pdf = await lireDocumentAppel(supabase, appelId);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Appel-${appel.reference}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (erreur) {
    if (erreur instanceof DocumentAbsent) return new Response(null, { status: 404 });
    if (erreur instanceof DocumentAltere) return new Response(null, { status: 409 });
    throw erreur;
  }
}
