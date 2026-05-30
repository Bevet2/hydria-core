import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HydriaPublicApiV1Service } from "../services/publicApi/hydriaPublicApiV1Service.js";
import { publicApiAskRequestSchema, type PublicApiAskRequest } from "../types/publicApi.js";

type Scenario = {
  id: string;
  request: PublicApiAskRequest;
  expect: (args: { response: Awaited<ReturnType<HydriaPublicApiV1Service["ask"]>>; runtimeMessages: string[] }) => string[];
};

const sessionId = "11111111-1111-4111-8111-111111111111";

function fakeChatResponse(message: string) {
  const content = message.includes("CA mensuel") && message.includes("1600")
    ? "Le chiffre d'affaires progresse de janvier a fevrier, puis recule legerement en mars; le niveau reste au-dessus de janvier."
    : message.toLowerCase().includes("postgresql")
      ? "PostgreSQL est une base de donnees relationnelle robuste, adaptee aux donnees structurees et aux requetes SQL."
      : "Hydria a traite la demande avec le contexte disponible.";

  return {
    sessionId,
    createdAt: "2026-05-30T12:00:00.000Z",
    runtimeMode: "conversation",
    category: "workspace_scenario",
    assistantMessage: { content },
    answer: { confidence: 84 },
    conversationState: {
      language: "fr",
      userGoal: message,
      knownFacts: []
    },
    activeConstraintCapsule: {
      topConstraints: []
    },
    tooling: {
      used: false,
      route: "not_needed",
      routing: {
        toolType: "none",
        intent: "none"
      },
      sources: []
    },
    generation: {
      provider: "ollama",
      model: "qwen2.5:3b",
      specialist: { role: "scenario_gate_stub" },
      attempts: [{ model: "qwen2.5:3b" }]
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    evidenceCapsule: {
      answerabilityMode: "direct"
    },
    agenticPlan: {
      mode: "direct"
    },
    knowledgeRetrieval: {
      used: false
    },
    orchestrationTrace: {
      version: "public_api_workspace_scenario_gate_trace_v1",
      disclosure: "runtime_trace_no_private_chain_of_thought",
      steps: []
    },
    usedRetry: false,
    durationMs: 10
  } as any;
}

function sheetPreview(columns: string[], rows: string[][]) {
  return JSON.stringify({
    kind: "hydria-sheet",
    version: 1,
    activeSheetId: "sheet-1",
    sheets: [{ id: "sheet-1", name: "Sheet 1", columns, rows }]
  });
}

function baseWorkspace(actions: string[], workspaceTools: string[] = []) {
  return {
    capabilities: {
      actions: actions as any[],
      workspaceTools,
      artifactFormats: ["xlsx", "csv", "docx", "md", "pptx"],
      workObjectKinds: ["dataset", "document", "presentation"]
    }
  };
}

const scenarios: Scenario[] = [
  {
    id: "plain_question_no_workspace",
    request: publicApiAskRequestSchema.parse({
      input: "Explique PostgreSQL simplement.",
      options: { includeProposedActions: true }
    }),
    expect: ({ response }) => [
      response.proposedActions.length === 0 ? "" : "expected no OS action for plain question",
      /PostgreSQL/i.test(response.answer) ? "" : "expected PostgreSQL answer"
    ]
  },
  {
    id: "numbers_to_excel_from_prompt",
    request: publicApiAskRequestSchema.parse({
      input: "Presente ces chiffres dans un Excel : Janvier 1200€, Fevrier 1600€, Mars 1400€.",
      workspaceContext: baseWorkspace(["create_artifact"])
    }),
    expect: ({ response }) => {
      const action = response.proposedActions[0];
      return [
        action?.type === "create_artifact" ? "" : "expected create_artifact",
        action?.payload.kind === "dataset" ? "" : "expected dataset",
        JSON.stringify(action?.payload.rows ?? []).includes("1600") ? "" : "expected extracted numeric rows"
      ];
    }
  },
  {
    id: "active_sheet_commentary",
    request: publicApiAskRequestSchema.parse({
      input: "Commente ces chiffres.",
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "CA mensuel",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Mois", "CA"], [["Janvier", "1200"], ["Fevrier", "1600"], ["Mars", "1400"]])
        },
        ...baseWorkspace(["reply"], ["sheet.apply_formula"])
      }
    }),
    expect: ({ response, runtimeMessages }) => [
      response.models.model === "workspace_context_answer_v1" ||
      runtimeMessages.some((message) => message.includes("CA mensuel") && message.includes("1600"))
        ? ""
        : "expected active sheet data in runtime message",
      /progresse|recule|janvier/i.test(response.answer) ? "" : "expected data commentary"
    ]
  },
  {
    id: "active_sheet_total_formula",
    request: publicApiAskRequestSchema.parse({
      input: "Fais le total en C.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Panier",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["nb de crayon", "prix"], [["10", "0.5"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.apply_formula"])
      }
    }),
    expect: ({ response }) => {
      const operations = response.proposedActions[0]?.payload.operations as any[] | undefined;
      return [
        response.proposedActions[0]?.payload.toolName === "sheet.apply_formula" ? "" : "expected sheet tool",
        JSON.stringify(operations ?? []).includes("=A2*B2") ? "" : "expected quantity x price total"
      ];
    }
  },
  {
    id: "active_sheet_sort_column",
    request: publicApiAskRequestSchema.parse({
      input: "Trie la colonne Prix du plus grand au plus petit.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Ventes",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Produit", "Prix"], [["A", "10"], ["B", "20"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.sort_range"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.sort_range" ? "" : "expected sheet.sort_range",
        operation?.target?.columnName === "Prix" ? "" : "expected Prix target",
        operation?.direction === "desc" ? "" : "expected descending sort"
      ];
    }
  },
  {
    id: "active_sheet_filter_column",
    request: publicApiAskRequestSchema.parse({
      input: "Filtre la colonne Prix sur 10.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Ventes",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Produit", "Prix"], [["A", "10"], ["B", "20"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.filter_rows"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.filter_rows" ? "" : "expected sheet.filter_rows",
        operation?.target?.columnName === "Prix" ? "" : "expected Prix target",
        operation?.value === "10" ? "" : "expected filter value 10"
      ];
    }
  },
  {
    id: "active_sheet_format_currency",
    request: publicApiAskRequestSchema.parse({
      input: "Formate la colonne Prix en devise.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Ventes",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Produit", "Prix"], [["A", "10"], ["B", "20"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.format_cells"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.format_cells" ? "" : "expected sheet.format_cells",
        operation?.target?.columnName === "Prix" ? "" : "expected Prix target",
        operation?.format?.numberFormat === "currency" ? "" : "expected currency format"
      ];
    }
  },
  {
    id: "active_sheet_add_chart",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute un graphique CA sur A1:B4.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "CA",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Mois", "CA"], [["Janvier", "1200"], ["Fevrier", "1600"], ["Mars", "1400"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.add_chart"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.add_chart" ? "" : "expected sheet.add_chart",
        operation?.range === "A1:B4" ? "" : "expected A1:B4 range"
      ];
    }
  },
  {
    id: "active_sheet_validation_dropdown",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute une validation liste 'Oui, Non' sur B2:B10.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Validation",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Client", "Statut"], [["A", ""], ["B", ""]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.set_data_validation"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.set_data_validation" ? "" : "expected sheet.set_data_validation",
        operation?.range === "B2:B10" ? "" : "expected B2:B10 range",
        JSON.stringify(operation?.payload?.values ?? []).includes("Oui") ? "" : "expected Oui/Non values"
      ];
    }
  },
  {
    id: "active_sheet_pivot_table",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute un tableau croise Ventes sur A1:B4.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Ventes",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Produit", "CA"], [["A", "1200"], ["B", "1600"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.add_pivot_table"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.add_pivot_table" ? "" : "expected sheet.add_pivot_table",
        operation?.range === "A1:B4" ? "" : "expected A1:B4 range"
      ];
    }
  },
  {
    id: "active_sheet_named_range",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute une plage nommee PrixRange sur A2:A10.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Prix",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Prix"], [["10"], ["20"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.add_named_range"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.add_named_range" ? "" : "expected sheet.add_named_range",
        operation?.range === "A2:A10" ? "" : "expected A2:A10 range"
      ];
    }
  },
  {
    id: "active_sheet_freeze_first_row",
    request: publicApiAskRequestSchema.parse({
      input: "Fige la premiere ligne.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "CA",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Mois", "CA"], [["Janvier", "1200"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.freeze_panes"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.freeze_panes" ? "" : "expected sheet.freeze_panes",
        operation?.payload?.rows === 1 ? "" : "expected one frozen row"
      ];
    }
  },
  {
    id: "active_sheet_hide_gridlines",
    request: publicApiAskRequestSchema.parse({
      input: "Masque le quadrillage.",
      metadata: { workspaceFamilyId: "data_spreadsheet" },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "CA",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Mois", "CA"], [["Janvier", "1200"]])
        },
        ...baseWorkspace(["workspace_tool_call"], ["sheet.show_gridlines"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "sheet.show_gridlines" ? "" : "expected sheet.show_gridlines",
        operation?.value === false ? "" : "expected gridlines false"
      ];
    }
  },
  {
    id: "active_doc_insert_section",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute une section Risques avec 'Verifier les sources avant publication.'",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Plan projet",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Plan projet\n\n## Introduction\n\nHydria OS connecte Core au workspace."
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.edit"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        response.proposedActions[0]?.payload.toolName === "doc.edit" ? "" : "expected doc.edit",
        operation?.type === "doc.insert_section" ? "" : "expected doc.insert_section",
        operation?.content === "Verifier les sources avant publication." ? "" : "expected quoted content preserved"
      ];
    }
  },
  {
    id: "active_doc_insert_page_break",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute un saut de page.",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Rapport",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Rapport\n\nContenu."
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.insert_page_break"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [operation?.type === "doc.insert_page_break" ? "" : "expected doc.insert_page_break"];
    }
  },
  {
    id: "active_doc_insert_toc",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute un sommaire.",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Rapport",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Rapport\n\n## Introduction\n\nTexte."
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.insert_toc"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [operation?.type === "doc.insert_toc" ? "" : "expected doc.insert_toc"];
    }
  },
  {
    id: "active_doc_insert_quote",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute une citation 'La connaissance doit rester gouvernee.'",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Rapport",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Rapport"
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.insert_quote"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "doc.insert_quote" ? "" : "expected doc.insert_quote",
        operation?.content === "La connaissance doit rester gouvernee." ? "" : "expected quote content"
      ];
    }
  },
  {
    id: "active_doc_insert_image",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute une image https://app.hydria.click/logo.png.",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Rapport",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Rapport"
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.insert_image"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "doc.insert_image" ? "" : "expected doc.insert_image",
        operation?.value === "https://app.hydria.click/logo.png" ? "" : "expected image URL"
      ];
    }
  },
  {
    id: "active_doc_replace_text",
    request: publicApiAskRequestSchema.parse({
      input: "Remplace 'Old text' par 'New text'.",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Plan projet",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Plan projet\n\nOld text"
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.replace_text"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "doc.replace_text" ? "" : "expected doc.replace_text",
        operation?.target?.oldText === "Old text" ? "" : "expected old text target",
        operation?.content === "New text" ? "" : "expected replacement content"
      ];
    }
  },
  {
    id: "active_doc_insert_link",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute un lien Hydria https://app.hydria.click.",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Plan projet",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Plan projet"
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.insert_link"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "doc.insert_link" ? "" : "expected doc.insert_link",
        operation?.value === "https://app.hydria.click" ? "" : "expected Hydria URL"
      ];
    }
  },
  {
    id: "active_doc_insert_code_block",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute un bloc code js 'const ok = true;'.",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Plan projet",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Plan projet"
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.insert_code_block"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "doc.insert_code_block" ? "" : "expected doc.insert_code_block",
        operation?.content === "const ok = true;" ? "" : "expected code content"
      ];
    }
  },
  {
    id: "active_doc_add_comment",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute un commentaire 'Verifier les chiffres' sur l'introduction.",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Plan projet",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Plan projet\n\n## Introduction\n\nTexte."
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.add_comment"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "doc.add_comment" ? "" : "expected doc.add_comment",
        operation?.content === "Verifier les chiffres" ? "" : "expected comment content",
        operation?.target?.heading === "Introduction" ? "" : "expected Introduction target"
      ];
    }
  },
  {
    id: "active_doc_summarize_intro",
    request: publicApiAskRequestSchema.parse({
      input: "Raccourcis l'introduction.",
      metadata: { workspaceFamilyId: "document_knowledge" },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Plan projet",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# Plan projet\n\n## Introduction\n\nHydria OS connecte Core au workspace. Les actions doivent rester tracables. Le document garde les decisions.\n\n## Risques\n\n- Mauvais routage"
        },
        ...baseWorkspace(["workspace_tool_call"], ["doc.edit"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        operation?.type === "doc.replace_block" ? "" : "expected doc.replace_block",
        operation?.target?.heading === "Introduction" ? "" : "expected Introduction target",
        /Hydria OS/.test(operation?.content ?? "") ? "" : "expected summarized intro content"
      ];
    }
  },
  {
    id: "active_slide_add",
    request: publicApiAskRequestSchema.parse({
      input: "Ajoute une slide Risques dans la presentation.",
      metadata: { workspaceFamilyId: "presentation" },
      workspaceContext: {
        activeWorkObject: {
          id: "deck-1",
          title: "Comite",
          kind: "presentation",
          workspaceFamilyId: "presentation",
          entryPath: "slides.md",
          contentPreview: "# Comite"
        },
        ...baseWorkspace(["workspace_tool_call"], ["slide.edit"])
      }
    }),
    expect: ({ response }) => {
      const operation = (response.proposedActions[0]?.payload.operations as any[] | undefined)?.[0];
      return [
        response.proposedActions[0]?.payload.toolName === "slide.edit" ? "" : "expected slide.edit",
        operation?.type === "slide.add" ? "" : "expected slide.add"
      ];
    }
  }
];

const runtimeMessages: string[] = [];
const service = new HydriaPublicApiV1Service({
  chatRuntimeService: {
    async sendMessage(input: { message: string }) {
      runtimeMessages.push(input.message);
      return fakeChatResponse(input.message);
    },
    resetSession() {}
  } as any
});

const results = [];
for (const scenario of scenarios) {
  const before = runtimeMessages.length;
  const response = await service.ask(scenario.request);
  const messages = runtimeMessages.slice(before);
  const issues = scenario.expect({ response, runtimeMessages: messages }).filter(Boolean);
  results.push({
    id: scenario.id,
    passed: issues.length === 0,
    issues,
    answer: response.answer,
    actionTypes: response.proposedActions.map((action) => action.type),
    toolNames: response.proposedActions.map((action) => action.payload.toolName).filter(Boolean),
    runtimeCalls: messages.length
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length
  },
  results
};

const trainingDir = resolve(process.cwd(), "..", "..", "storage", "training");
const output = resolve(trainingDir, "public-api-workspace-scenario-gate-v1.json");
await mkdir(trainingDir, { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ ...report.summary, output }, null, 2));
if (report.summary.failed > 0) {
  process.exitCode = 1;
}
