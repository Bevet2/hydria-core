import { z } from "zod";
import type { ChatRuntimeService } from "../chatRuntimeService.js";
import { parseLooseJson } from "../../utils/jsonRepair.js";
import type { PublicApiAskRequest } from "../../types/publicApi.js";

const planSchema = z.object({
  title: z.string().min(1).max(300),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1).max(200),
        goal: z.string().max(400).optional()
      })
    )
    .min(1)
    .max(8)
});

type LongFormPlan = z.infer<typeof planSchema>;

function normalizeText(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown, maxChars = 1200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trim()}...`;
}

/**
 * Returns true when the question asks for a multi-section long-form document.
 * Conservative — only triggers on clear action verb + recognised document type.
 */
export function isLongFormRequest(question: string): boolean {
  const q = normalizeText(question);
  const verbPattern =
    /\b(ecris|redige|rediger|ecrire|cree|creer|genere|generer|prepare|preparer|elabore|elaborer|produis|produire|fais|faire|realise|realiser|construis|construire)\b/;
  const docPattern =
    /\b(rapport|document|bilan|synthese|presentation|biographie|analyse.?(complete|detaillee?)?|compte.?rendu|guide|etude|note.?(de.?)?synthese|revue|dossier|fiche)\b/;
  return verbPattern.test(q) && docPattern.test(q);
}

function resolveQuestion(request: PublicApiAskRequest) {
  return (request.input ?? request.question ?? "").trim();
}

export function buildSourcesBlock(request: PublicApiAskRequest): string {
  const parts: string[] = [];
  const active = request.workspaceContext?.activeWorkObject;
  if (active?.contentPreview) {
    parts.push(
      `Source principale — ${active.title || active.kind || "document actif"}:\n${compact(active.contentPreview, 2500)}`
    );
  }
  const additional = request.workspaceContext?.additionalSources ?? [];
  for (const src of additional.slice(0, 4)) {
    if (src.contentPreview) {
      parts.push(
        `Source — ${src.title || src.kind || src.id}:\n${compact(src.contentPreview, 1500)}`
      );
    }
  }
  return parts.join("\n\n---\n\n");
}

// Document type → style instructions
const DOC_TYPE_PATTERNS: Array<[RegExp, string, string]> = [
  [/\brappor(t|ter)\b/, "rapport", "Structure: résumé exécutif → contexte → résultats/données → analyse → conclusions → recommandations. Ton formel, factuel, chiffres si disponibles."],
  [/\bsynthese\b/, "synthese", "Points clés en premier, insights décisionnels, pas de détails superflus. Chaque section = un message clair. Ton concis."],
  [/\bpresentation\b/, "presentation", "Chaque section = 3 à 5 points max, pensée pour des slides. Bullet points. Titres accrocheurs. Formulations courtes et percutantes."],
  [/\bbilan\b/, "bilan", "Structure: situation initiale → évolution → résultats actuels → points positifs et négatifs → perspectives. Inclure des chiffres si disponibles."],
  [/\bcompte.?rendu\b/, "compte_rendu", "Structure: contexte/participants → points discutés par sujet → décisions prises → actions à suivre (responsable + délai). Ton factuel."],
  [/\bguide\b/, "guide", "Étapes numérotées, claires et actionnables. Une idée par section. Exemples pratiques. Ton accessible."],
  [/\banalyse\b/, "analyse", "Structure: méthodologie → observations → données → interprétation → conclusions. Argumentaire rigoureux, données à l'appui."],
  [/\bbiographie\b/, "biographie", "Structure chronologique ou thématique. Faits vérifiables, contexte historique, impact. Ton narratif mais factuel."],
  [/\b(email|lettre|courrier|mail)\b/, "email", "Objet/sujet clair, ton adapté au contexte (formel ou informel), corps concis et structuré, appel à l'action explicite, formule de politesse."],
  [/\betude\b/, "etude", "Structure académique: introduction → état de l'art → méthode → résultats → discussion → conclusion. Références si disponibles."],
  [/\bnote.?(de.?)?service\b/, "note_service", "Format court, titre + date + destinataires, corps en paragraphes courts, décision ou action attendue mise en évidence."]
];

export type DocumentType = string;

export function detectDocumentType(question: string): DocumentType | null {
  const q = normalizeText(question);
  for (const [pattern, type] of DOC_TYPE_PATTERNS) {
    if (pattern.test(q)) return type;
  }
  return null;
}

function getDocumentTypeStyle(docType: DocumentType | null): string {
  if (!docType) return "Structure logique, contenu factuel et précis. Adapte le ton et le format à la demande.";
  const found = DOC_TYPE_PATTERNS.find(([, type]) => type === docType);
  return found?.[2] ?? "Structure logique, contenu factuel et précis.";
}

export type LongFormResult = {
  content: string;
  plan: LongFormPlan | null;
  sectionCount: number;
  documentType: DocumentType | null;
  sessionId: string | undefined;
};

export class LongFormGenerationService {
  constructor(private chatRuntime: Pick<ChatRuntimeService, "sendMessage">) {}

  async generate(request: PublicApiAskRequest): Promise<LongFormResult> {
    const question = resolveQuestion(request);
    const sourcesBlock = buildSourcesBlock(request);
    const docType = detectDocumentType(question);
    const styleGuide = getDocumentTypeStyle(docType);

    // Step 1: Generate structural plan with style-aware instructions
    const planPrompt = [
      `Ta tâche: créer un plan structuré JSON pour répondre à cette demande:`,
      `"${compact(question, 400)}"`,
      `\nStyle attendu pour ce document: ${styleGuide}`,
      sourcesBlock ? `\nSources disponibles:\n${compact(sourcesBlock, 1800)}` : "",
      `\nRéponds UNIQUEMENT avec du JSON valide (pas de markdown autour):`,
      `{"title": "Titre du document", "sections": [{"heading": "Titre section", "goal": "Ce que cette section doit couvrir"}]}`,
      `Génère entre 3 et 6 sections adaptées au type de document. Adapte la langue à la demande.`
    ]
      .filter(Boolean)
      .join("\n");

    const planResult = await this.chatRuntime.sendMessage({
      message: planPrompt,
      ...(request.sessionId ? { sessionId: request.sessionId } : {})
    });

    let plan: LongFormPlan | null = null;
    try {
      const raw = parseLooseJson(planResult.assistantMessage.content, "long-form plan");
      plan = planSchema.parse(raw);
    } catch {
      // Plan parsing failed — return what the model generated (may already be useful)
      return {
        content: planResult.assistantMessage.content,
        plan: null,
        sectionCount: 0,
        documentType: docType,
        sessionId: planResult.sessionId
      };
    }

    // Step 2: Generate each section independently with style context
    const sectionContents: string[] = [];
    for (const section of plan.sections) {
      const previousContent = sectionContents.join("\n\n");
      const sectionPrompt = [
        `Tu rédiges la section "${section.heading}" d'un document de type "${docType ?? "document"}" intitulé "${plan.title}".`,
        `Style à respecter: ${styleGuide}`,
        section.goal ? `Objectif de cette section: ${section.goal}` : "",
        previousContent
          ? `\nContenu déjà rédigé (pour cohérence, ne pas répéter):\n${compact(previousContent, 1200)}`
          : "",
        sourcesBlock ? `\nSources à utiliser:\n${compact(sourcesBlock, 1800)}` : "",
        `\nRédige UNIQUEMENT le contenu de la section "${section.heading}". Ne réécris pas le titre. Sois précis et factuel. Garde la langue du document.`
      ]
        .filter(Boolean)
        .join("\n");

      const sectionResult = await this.chatRuntime.sendMessage({
        message: sectionPrompt,
        ...(planResult.sessionId ? { sessionId: planResult.sessionId } : {})
      });
      sectionContents.push(
        `## ${section.heading}\n\n${sectionResult.assistantMessage.content.trim()}`
      );
    }

    const assembled = `# ${plan.title}\n\n${sectionContents.join("\n\n")}`;
    return {
      content: assembled,
      plan,
      sectionCount: plan.sections.length,
      documentType: docType,
      sessionId: planResult.sessionId
    };
  }
}
