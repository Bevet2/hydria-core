import type { PublicApiAskRequest, PublicApiProposedAction } from "../types/publicApi.js";

type WorkspaceContext = NonNullable<PublicApiAskRequest["workspaceContext"]>;

export type HydriaOsOfficeWorkspaceActionCase = {
  id: string;
  workspaceFamily: "data_spreadsheet" | "document_knowledge";
  description: string;
  input: string;
  workspaceContext: WorkspaceContext;
  expected: {
    actionType: PublicApiProposedAction["type"];
    fastPath: boolean;
    targetWorkObjectId?: string;
    entryPath?: string;
    format?: string;
    kind?: string;
    mode?: string;
    columns?: string[];
    sections?: string[];
  };
  trainingNote: string;
};

const baseCapabilities = {
  actions: ["reply", "create_artifact", "create_work_object", "update_work_object", "set_work_object_metadata"],
  artifactFormats: ["xlsx", "csv", "docx", "pdf", "pptx", "md", "txt"],
  workObjectKinds: ["document", "dataset", "presentation", "dashboard", "workflow", "project"]
} satisfies WorkspaceContext["capabilities"];

const dryRunPolicy = {
  mode: "dry_run",
  requireConfirmation: true
} satisfies WorkspaceContext["executionPolicy"];

function spreadsheetContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    os: { name: "Hydria OS" },
    activeWorkObject: {
      id: "sheet-pipeline-1",
      title: "Pipeline ventes",
      kind: "dataset",
      entryPath: "pipeline.csv",
      contentPreview: "Client,Statut,Priorite\nAcme,Nouveau,Haute",
      editable: true
    },
    capabilities: baseCapabilities,
    executionPolicy: dryRunPolicy,
    ...overrides
  };
}

function documentContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    os: { name: "Hydria OS" },
    activeWorkObject: {
      id: "doc-brief-1",
      title: "Brief projet",
      kind: "document",
      entryPath: "brief.md",
      contentPreview: "# Brief projet\n\n## Objectif\nClarifier le lancement.",
      editable: true
    },
    capabilities: baseCapabilities,
    executionPolicy: dryRunPolicy,
    ...overrides
  };
}

export const hydriaOsOfficeWorkspaceActionPack: HydriaOsOfficeWorkspaceActionCase[] = [
  {
    id: "excel-add-budget-column",
    workspaceFamily: "data_spreadsheet",
    description: "Add one column to the active spreadsheet without model generation.",
    input: "Ajoute une colonne Budget au tableur actif.",
    workspaceContext: spreadsheetContext(),
    expected: {
      actionType: "update_work_object",
      fastPath: true,
      targetWorkObjectId: "sheet-pipeline-1",
      entryPath: "pipeline.csv",
      mode: "append",
      columns: ["Budget"]
    },
    trainingNote: "Excel/tableur action: update active dataset by appending a requested column."
  },
  {
    id: "excel-add-formula-column",
    workspaceFamily: "data_spreadsheet",
    description: "Add a calculated margin field to the active spreadsheet.",
    input: "Ajoute une colonne Marge calculee au fichier CSV actif.",
    workspaceContext: spreadsheetContext(),
    expected: {
      actionType: "update_work_object",
      fastPath: true,
      targetWorkObjectId: "sheet-pipeline-1",
      entryPath: "pipeline.csv",
      mode: "append",
      columns: ["Marge calculee"]
    },
    trainingNote: "Excel/tableur action: preserve the active CSV target and keep execution in OS."
  },
  {
    id: "excel-create-tracker",
    workspaceFamily: "data_spreadsheet",
    description: "Create a spreadsheet artifact with declared columns.",
    input: "Cree un Excel de suivi client avec colonnes Client, Statut, Budget et Prochaine action.",
    workspaceContext: spreadsheetContext({
      activeWorkObject: undefined
    }),
    expected: {
      actionType: "create_artifact",
      fastPath: true,
      format: "xlsx",
      kind: "dataset",
      columns: ["Client", "Statut", "Budget", "Prochaine action"]
    },
    trainingNote: "Excel/tableur creation: create an xlsx artifact when the OS advertises xlsx."
  },
  {
    id: "excel-rename-object",
    workspaceFamily: "data_spreadsheet",
    description: "Rename the active spreadsheet object through metadata.",
    input: "Renomme ce tableur en Pipeline ventes Q3.",
    workspaceContext: spreadsheetContext(),
    expected: {
      actionType: "set_work_object_metadata",
      fastPath: true,
      targetWorkObjectId: "sheet-pipeline-1",
      entryPath: "pipeline.csv"
    },
    trainingNote: "Excel/tableur metadata: title changes are metadata actions, not content rewrites."
  },
  {
    id: "word-add-risk-section",
    workspaceFamily: "document_knowledge",
    description: "Add a section to the active document without model generation.",
    input: "Ajoute une section Risques au document actif.",
    workspaceContext: documentContext(),
    expected: {
      actionType: "update_work_object",
      fastPath: true,
      targetWorkObjectId: "doc-brief-1",
      entryPath: "brief.md",
      mode: "append",
      sections: ["Risques"]
    },
    trainingNote: "Word/document action: append a requested section to the active document."
  },
  {
    id: "word-rewrite-introduction",
    workspaceFamily: "document_knowledge",
    description: "Rewrite a document introduction as a workspace update.",
    input: "Reformule l'introduction du document pour un ton plus executif.",
    workspaceContext: documentContext(),
    expected: {
      actionType: "update_work_object",
      fastPath: true,
      targetWorkObjectId: "doc-brief-1",
      entryPath: "brief.md",
      mode: "replace"
    },
    trainingNote: "Word/document action: rewrite requests target the active document and stay dry-run."
  },
  {
    id: "word-create-project-brief",
    workspaceFamily: "document_knowledge",
    description: "Create a Word document artifact with explicit sections.",
    input: "Redige un document Word de brief projet avec sections Objectif, Risques et Prochaines etapes.",
    workspaceContext: documentContext({
      activeWorkObject: undefined
    }),
    expected: {
      actionType: "create_artifact",
      fastPath: true,
      format: "docx",
      kind: "document",
      sections: ["Objectif", "Risques", "Prochaines etapes"]
    },
    trainingNote: "Word/document creation: create a docx artifact for a structural document request."
  },
  {
    id: "word-retitle-document",
    workspaceFamily: "document_knowledge",
    description: "Retitle the active document through metadata.",
    input: "Change le titre du document en Plan de migration.",
    workspaceContext: documentContext(),
    expected: {
      actionType: "set_work_object_metadata",
      fastPath: true,
      targetWorkObjectId: "doc-brief-1",
      entryPath: "brief.md"
    },
    trainingNote: "Word/document metadata: retitling does not require content generation."
  },
  {
    id: "word-biography-requires-research",
    workspaceFamily: "document_knowledge",
    description: "Historical biography must not skip the normal sourced runtime.",
    input: "Redige une biographie de Louis IX de France dans un document Word.",
    workspaceContext: documentContext({
      activeWorkObject: undefined
    }),
    expected: {
      actionType: "create_artifact",
      fastPath: false,
      format: "docx",
      kind: "document"
    },
    trainingNote: "Word/document creation with factual content: research/model runtime must run before proposing the docx."
  },
  {
    id: "word-ai-news-requires-research",
    workspaceFamily: "document_knowledge",
    description: "Current AI news update must not use the deterministic action fast path.",
    input: "Ajoute les nouveautes IA de cette semaine au document actif avec sources.",
    workspaceContext: documentContext(),
    expected: {
      actionType: "update_work_object",
      fastPath: false,
      targetWorkObjectId: "doc-brief-1",
      entryPath: "brief.md",
      mode: "append"
    },
    trainingNote: "Word/document update with current facts: require source-backed runtime before OS action."
  },
  {
    id: "excel-conceptual-csv-no-action",
    workspaceFamily: "data_spreadsheet",
    description: "Conceptual CSV question should answer, not mutate the workspace.",
    input: "Explique comment nettoyer un CSV avant import.",
    workspaceContext: spreadsheetContext(),
    expected: {
      actionType: "reply",
      fastPath: false
    },
    trainingNote: "Excel/tableur conceptual question: no workspace mutation unless user asks for one."
  },
  {
    id: "word-conceptual-doc-no-action",
    workspaceFamily: "document_knowledge",
    description: "Conceptual document structuring should answer, not mutate the workspace.",
    input: "Comment structurer un document de migration ?",
    workspaceContext: documentContext(),
    expected: {
      actionType: "reply",
      fastPath: false
    },
    trainingNote: "Word/document conceptual question: no workspace mutation unless user asks for one."
  }
];
