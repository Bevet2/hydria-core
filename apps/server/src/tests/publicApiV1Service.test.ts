import test from "node:test";
import assert from "node:assert/strict";
import { HydriaPublicApiV1Service } from "../services/publicApi/hydriaPublicApiV1Service.js";
import { planPublicApiProposedActions } from "../services/publicApi/osActionPlanner.js";
import { publicApiAskRequestSchema } from "../types/publicApi.js";

const sessionId = "11111111-1111-4111-8111-111111111111";

function chatResponse(overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    createdAt: "2026-05-27T12:00:00.000Z",
    runtimeMode: "conversation",
    category: "technical_explanation",
    assistantMessage: {
      content: "NVIDIA est une entreprise technologique qui concoit des GPU et des plateformes d'IA."
    },
    answer: {
      confidence: 86
    },
    conversationState: {
      language: "fr",
      userGoal: "Qu'est-ce que NVIDIA ?",
      knownFacts: ["On parle de NVIDIA."]
    },
    activeConstraintCapsule: {
      topConstraints: ["reponse concise"]
    },
    tooling: {
      used: true,
      route: "used",
      routing: {
        toolType: "research",
        intent: "fact_check"
      },
      sources: [
        {
          title: "Wikipedia: Nvidia",
          url: "https://fr.wikipedia.org/wiki/Nvidia",
          snippet: "Nvidia Corporation est une societe de technologie.",
          excerpt: "Nvidia Corporation est une societe americaine de technologie."
        }
      ]
    },
    generation: {
      provider: "tool",
      model: "research_fact_check",
      specialist: {
        role: "source_research"
      },
      attempts: [
        {
          model: "gemma3n:e4b"
        }
      ]
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    evidenceCapsule: {
      answerabilityMode: "source_backed"
    },
    agenticPlan: {
      mode: "evidence_first"
    },
    knowledgeRetrieval: {
      used: false
    },
    orchestrationTrace: {
      version: "chat_orchestration_trace_v1",
      disclosure: "runtime_trace_no_private_chain_of_thought",
      steps: []
    },
    usedRetry: false,
    durationMs: 1234,
    ...overrides
  } as any;
}

test("public API ask schema accepts input alias and defaults output options", () => {
  const parsed = publicApiAskRequestSchema.parse({
    input: "Qu'est-ce que NVIDIA ?"
  });

  assert.equal(parsed.input, "Qu'est-ce que NVIDIA ?");
  assert.equal(parsed.options.includeSources, true);
  assert.equal(parsed.options.includeTrace, false);
  assert.equal(parsed.options.includeProposedActions, true);
  assert.throws(() => publicApiAskRequestSchema.parse({}), /Either input or question is required/);
});

test("public API v1 maps chat runtime output into a stable integration envelope", async () => {
  let received: unknown = null;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage(input: unknown) {
        received = input;
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Qu'est-ce que NVIDIA ?",
      sessionId
    })
  );

  assert.deepEqual(received, {
    message: "Qu'est-ce que NVIDIA ?",
    sessionId
  });
  assert.equal(response.object, "hydria.answer");
  assert.equal(response.sessionId, sessionId);
  assert.match(response.answer, /NVIDIA/);
  assert.equal(response.sources[0]?.url, "https://fr.wikipedia.org/wiki/Nvidia");
  assert.equal(response.tools.used, true);
  assert.equal(response.models.provider, "tool");
  assert.equal(response.memory.contextTracked, true);
  assert.deepEqual(response.proposedActions, []);
  assert.equal("trace" in response, false);
});

test("public API v1 returns dry-run proposed actions for Hydria OS workspaces", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse({
          assistantMessage: {
            content: "Je vais proposer une modification du tableau actif."
          }
        });
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Ajoute une colonne Priorite dans le tableur.",
      workspaceContext: {
        os: {
          name: "Hydria OS"
        },
        activeWorkObject: {
          id: "work-object-1",
          title: "Pipeline ventes",
          kind: "dataset",
          entryPath: "table.csv",
          contentPreview: "Client,Status"
        },
        capabilities: {
          actions: ["reply", "update_work_object", "create_artifact"],
          artifactFormats: ["xlsx", "csv"],
          workObjectKinds: ["dataset", "document"]
        }
      }
    })
  );

  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "update_work_object");
  assert.equal(response.proposedActions[0]?.target.workObjectId, "work-object-1");
  assert.equal(response.proposedActions[0]?.dryRun, true);
  assert.equal(response.proposedActions[0]?.requiresConfirmation, true);
  assert.equal(response.proposedActions[0]?.payload.mode, "append");
  assert.equal(response.proposedActions[0]?.payload.workspaceFamilyId, "");
});

test("public API v1 injects active Sheet data when the user asks for commentary", async () => {
  let receivedMessage = "";
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage(input: any) {
        receivedMessage = input.message;
        return chatResponse({
          assistantMessage: {
            content: "Le chiffre d'affaires progresse de janvier a fevrier, puis recule en mars."
          },
          tooling: {
            used: false,
            route: "not_needed",
            routing: {
              toolType: "none",
              intent: "workspace_analysis"
            },
            sources: []
          },
          generation: {
            provider: "ollama",
            model: "gemma3n:e4b",
            specialist: {
              role: "workspace_analysis"
            },
            attempts: [{ model: "gemma3n:e4b" }]
          }
        });
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Commente ces chiffres.",
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "CA mensuel",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: JSON.stringify({
            kind: "hydria-sheet",
            columns: ["Mois", "CA"],
            rows: [["Janvier", "1200"], ["Fevrier", "1600"], ["Mars", "1400"]]
          })
        },
        capabilities: {
          actions: ["reply"],
          workspaceTools: ["sheet.apply_formula"],
          artifactFormats: ["xlsx"],
          workObjectKinds: ["dataset"]
        }
      }
    })
  );

  assert.match(receivedMessage, /Question utilisateur:\nCommente ces chiffres\./);
  assert.match(receivedMessage, /CA mensuel/);
  assert.match(receivedMessage, /Janvier/);
  assert.match(receivedMessage, /1600/);
  assert.match(response.answer, /progresse/);
});

test("public API v1 extracts figures from a prompt into spreadsheet rows", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("numeric spreadsheet fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Presente ces chiffres dans un Excel : Janvier 1200€, Fevrier 1600€, Mars 1400€.",
      workspaceContext: {
        capabilities: {
          actions: ["create_artifact"],
          artifactFormats: ["xlsx", "csv"],
          workObjectKinds: ["dataset"]
        }
      }
    })
  );

  assert.equal(response.models.provider, "policy");
  assert.equal(response.proposedActions[0]?.type, "create_artifact");
  assert.equal(response.proposedActions[0]?.payload.kind, "dataset");
  assert.equal(response.proposedActions[0]?.payload.format, "xlsx");
  assert.deepEqual(response.proposedActions[0]?.payload.columns, ["Libelle", "Valeur", "Unite"]);
  assert.deepEqual(response.proposedActions[0]?.payload.rows, [
    ["Janvier", "1200", "€"],
    ["Fevrier", "1600", "€"],
    ["Mars", "1400", "€"]
  ]);
});

test("public API v1 proposes workspace tool calls for sheet formulas", async () => {
  let chatCalls = 0;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        chatCalls += 1;
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Ajoute une colonne Total avec la formule =B2*C2 dans le tableur.",
      metadata: {
        workspaceFamilyId: "data_spreadsheet"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Ventes",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: "{\"kind\":\"hydria-sheet\"}"
        },
        capabilities: {
          actions: ["reply", "workspace_tool_call", "update_work_object"],
          workspaceTools: ["sheet.apply_formula"],
          artifactFormats: ["xlsx"],
          workObjectKinds: ["dataset"]
        }
      }
    })
  );

  assert.equal(chatCalls, 0);
  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(response.proposedActions[0]?.payload.toolName, "sheet.apply_formula");
  assert.equal(response.proposedActions[0]?.payload.contractVersion, "workspace_tool_call.v1");
  assert.equal(response.proposedActions[0]?.payload.expectedSurface, "sheet");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.type, "sheet.add_column");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.columnName, "Total");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.formula, "=B2*C2");
});

test("public API v1 keeps implicit Sheet sum requests on the active sheet", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });
  const sheetPreview = JSON.stringify({
    kind: "hydria-sheet",
    activeSheetId: "sheet-1",
    sheets: [
      {
        id: "sheet-1",
        columns: ["A", "B"],
        rows: [
          ["10", "2"],
          ["5", "4"]
        ]
      }
    ]
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Fais la somme en C.",
      metadata: {
        workspaceFamilyId: "data_spreadsheet"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Calculs",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview
        },
        capabilities: {
          actions: ["reply", "workspace_tool_call", "create_artifact"],
          workspaceTools: ["sheet.apply_formula", "doc.insert_section"],
          artifactFormats: ["docx", "xlsx"],
          workObjectKinds: ["dataset", "document"]
        }
      }
    })
  );

  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(response.proposedActions[0]?.payload.expectedSurface, "sheet");
  assert.equal(response.proposedActions[0]?.payload.toolName, "sheet.apply_formula");
  const operations = response.proposedActions[0]?.payload.operations as any[];
  assert.equal(operations[0]?.type, "sheet.add_column");
  assert.equal(operations[0]?.columnName, "C");
  assert.equal(operations[0]?.target.columnIndex, 2);
  assert.equal(operations[1]?.type, "sheet.set_range");
  assert.equal(operations[1]?.range, "C2:C3");
  assert.deepEqual(operations[1]?.values, [["=SOMME(A2:B2)"], ["=SOMME(A3:B3)"]]);
});

test("public API v1 infers total as quantity times price from Sheet headers", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Fais le total.",
      metadata: {
        workspaceFamilyId: "data_spreadsheet"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Calculs",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: JSON.stringify({
            kind: "hydria-sheet",
            columns: ["nb de crayon", "prix", "Column 3"],
            rows: [["10", "0.5", "=A2+B2"]]
          })
        },
        capabilities: {
          actions: ["reply", "workspace_tool_call", "create_artifact"],
          workspaceTools: ["sheet.apply_formula", "doc.insert_section"],
          artifactFormats: ["docx", "xlsx"],
          workObjectKinds: ["dataset", "document"]
        }
      }
    })
  );

  const operations = response.proposedActions[0]?.payload.operations as any[];
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(response.proposedActions[0]?.payload.expectedSurface, "sheet");
  assert.equal(operations[0]?.type, "sheet.add_column");
  assert.equal(operations[0]?.columnName, "Total");
  assert.equal(operations[0]?.target.columnIndex, 2);
  assert.equal(operations[1]?.type, "sheet.set_range");
  assert.equal(operations[1]?.range, "C2:C2");
  assert.deepEqual(operations[1]?.values, [["=A2*B2"]]);
});

test("public API v1 understands Sheet amount and revenue intent from data shape", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const amountResponse = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Complete le montant.",
      metadata: {
        workspaceFamilyId: "data_spreadsheet"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Ventes",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: JSON.stringify({
            kind: "hydria-sheet",
            columns: ["Article", "Quantite", "Prix unitaire", "Montant"],
            rows: [["Stylo", "3", "1.5", ""]]
          })
        },
        capabilities: {
          actions: ["workspace_tool_call"],
          workspaceTools: ["sheet.apply_formula"],
          workObjectKinds: ["dataset"]
        }
      }
    })
  );

  const amountOps = amountResponse.proposedActions[0]?.payload.operations as any[];
  assert.equal(amountOps.length, 1);
  assert.equal(amountOps[0]?.type, "sheet.set_range");
  assert.equal(amountOps[0]?.range, "D2:D2");
  assert.deepEqual(amountOps[0]?.values, [["=B2*C2"]]);

  const revenueResponse = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Fais le total.",
      metadata: {
        workspaceFamilyId: "data_spreadsheet"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "CA trimestriel",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: JSON.stringify({
            kind: "hydria-sheet",
            columns: ["Janvier", "Fevrier", "Mars", "Total"],
            rows: [["10", "20", "30", ""]]
          })
        },
        capabilities: {
          actions: ["workspace_tool_call"],
          workspaceTools: ["sheet.apply_formula"],
          workObjectKinds: ["dataset"]
        }
      }
    })
  );

  const revenueOps = revenueResponse.proposedActions[0]?.payload.operations as any[];
  assert.equal(revenueOps.length, 1);
  assert.equal(revenueOps[0]?.type, "sheet.set_range");
  assert.equal(revenueOps[0]?.range, "D2:D2");
  assert.deepEqual(revenueOps[0]?.values, [["=SOMME(A2:C2)"]]);
});

test("public API v1 infers total from multiple quantity columns and a unit price", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Fais le total.",
      metadata: {
        workspaceFamilyId: "data_spreadsheet"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Crayons",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: JSON.stringify({
            kind: "hydria-sheet",
            columns: ["nb de crayon gris", "nb de crayon rouge", "prix", "Total"],
            rows: [["10", "10", "0.5", "5"]]
          })
        },
        capabilities: {
          actions: ["workspace_tool_call"],
          workspaceTools: ["sheet.apply_formula"],
          workObjectKinds: ["dataset"]
        }
      }
    })
  );

  const operations = response.proposedActions[0]?.payload.operations as any[];
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(operations.length, 1);
  assert.equal(operations[0]?.type, "sheet.set_range");
  assert.equal(operations[0]?.range, "D2:D2");
  assert.deepEqual(operations[0]?.values, [["=SOMME(A2:B2)*C2"]]);
});

test("public API v1 treats correction wording as computed Sheet intent", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const contentPreview = JSON.stringify({
    kind: "hydria-sheet",
    columns: ["nb de crayon gris", "nb de crayon rouge", "prix", "Total"],
    rows: [["10", "10", "0.5", "5"]]
  });

  for (const input of ["Corrige le total.", "Mets le bon total.", "Corrige le calcul."]) {
    const response = await service.ask(
      publicApiAskRequestSchema.parse({
        input,
        metadata: {
          workspaceFamilyId: "data_spreadsheet"
        },
        workspaceContext: {
          activeWorkObject: {
            id: "sheet-1",
            title: "Crayons",
            kind: "dataset",
            workspaceFamilyId: "data_spreadsheet",
            entryPath: "table.csv",
            contentPreview
          },
          capabilities: {
            actions: ["workspace_tool_call"],
            workspaceTools: ["sheet.apply_formula"],
            workObjectKinds: ["dataset"]
          }
        }
      })
    );

    const operations = response.proposedActions[0]?.payload.operations as any[];
    assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
    assert.equal(operations.length, 1);
    assert.equal(operations[0]?.type, "sheet.set_range");
    assert.equal(operations[0]?.range, "D2:D2");
    assert.deepEqual(operations[0]?.values, [["=SOMME(A2:B2)*C2"]]);
  }
});

test("public API v1 treats hydria-sheet content as Sheet even if metadata is stale", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Fais la somme en C.",
      metadata: {
        workspaceFamilyId: "document_knowledge"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-doc-1",
          title: "Calculs",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "document.json",
          contentPreview: "{\"kind\":\"hydria-sheet\",\"columns\":[\"A\",\"B\"],\"rows\":[[\"1\",\"2\"]]}"
        },
        capabilities: {
          actions: ["reply", "workspace_tool_call", "create_artifact"],
          workspaceTools: ["sheet.apply_formula", "doc.insert_section"],
          artifactFormats: ["docx", "xlsx"],
          workObjectKinds: ["dataset", "document"]
        }
      }
    })
  );

  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(response.proposedActions[0]?.payload.expectedSurface, "sheet");
  const operations = response.proposedActions[0]?.payload.operations as any[];
  assert.equal(operations[0]?.type, "sheet.add_column");
  assert.equal(operations[1]?.type, "sheet.set_range");
});

test("public API v1 proposes Sheet edit tool calls for OS operation capabilities", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const baseRequest = {
    metadata: {
      workspaceFamilyId: "data_spreadsheet"
    },
    workspaceContext: {
      activeWorkObject: {
        id: "sheet-1",
        title: "Ventes",
        kind: "dataset",
        workspaceFamilyId: "data_spreadsheet",
        entryPath: "table.csv",
        contentPreview: "{\"kind\":\"hydria-sheet\"}"
      },
      capabilities: {
        actions: ["workspace_tool_call"],
        workspaceTools: ["sheet.rename_column", "sheet.sort_range", "sheet.filter_rows", "sheet.format_cells"],
        artifactFormats: ["xlsx"],
        workObjectKinds: ["dataset"]
      }
    }
  } as const;

  const rename = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Renomme la colonne Prix en Prix HT."
  }));
  assert.equal((rename.proposedActions[0]?.payload.operations as any[])[0]?.type, "sheet.rename_column");
  assert.equal((rename.proposedActions[0]?.payload.operations as any[])[0]?.target.columnName, "Prix");
  assert.equal((rename.proposedActions[0]?.payload.operations as any[])[0]?.value, "Prix HT");

  const sort = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Trie la colonne Prix en descendant."
  }));
  assert.equal((sort.proposedActions[0]?.payload.operations as any[])[0]?.type, "sheet.sort_range");
  assert.equal((sort.proposedActions[0]?.payload.operations as any[])[0]?.direction, "desc");

  const filter = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Filtre la colonne Statut sur Paye."
  }));
  assert.equal((filter.proposedActions[0]?.payload.operations as any[])[0]?.type, "sheet.filter_rows");
  assert.equal((filter.proposedActions[0]?.payload.operations as any[])[0]?.value, "Paye");

  const format = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Mets la colonne Prix en devise et en gras."
  }));
  assert.equal((format.proposedActions[0]?.payload.operations as any[])[0]?.type, "sheet.format_cells");
  assert.equal((format.proposedActions[0]?.payload.operations as any[])[0]?.format.numberFormat, "currency");
  assert.equal((format.proposedActions[0]?.payload.operations as any[])[0]?.format.bold, true);
});

test("public API v1 plans broad Sheet workspace operations from user intent and data", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const baseRequest = {
    metadata: {
      workspaceFamilyId: "data_spreadsheet"
    },
    workspaceContext: {
      activeWorkObject: {
        id: "sheet-1",
        title: "Ventes",
        kind: "dataset",
        workspaceFamilyId: "data_spreadsheet",
        entryPath: "table.csv",
        contentPreview: JSON.stringify({
          kind: "hydria-sheet",
          columns: ["Client", "Statut", "Prix", "Total"],
          rows: [
            ["Acme", "Paye", "10", ""],
            ["Beta", "Impayé", "20", ""]
          ],
          rowCount: 2
        })
      },
      capabilities: {
        actions: ["workspace_tool_call"],
        workspaceTools: ["sheet.apply_formula"],
        workObjectKinds: ["dataset"]
      }
    }
  } as const;

  const cases = [
    ["Ajoute une colonne Priorite.", "sheet.add_column", (operation: any) => assert.equal(operation.columnName, "Priorite")],
    ["Insere 2 lignes.", "sheet.insert_rows", (operation: any) => assert.equal(operation.count, 2)],
    ["Insere 2 colonnes.", "sheet.insert_columns", (operation: any) => assert.equal(operation.count, 2)],
    ["Redimensionne la colonne Prix largeur 140.", "sheet.resize_column", (operation: any) => assert.equal(operation.width, 140)],
    ["Redimensionne la ligne 2 hauteur 32.", "sheet.resize_row", (operation: any) => assert.equal(operation.height, 32)],
    ["Efface le filtre.", "sheet.clear_filter"],
    ["Efface les cellules A2:B2.", "sheet.clear_cells", (operation: any) => assert.equal(operation.range, "A2:B2")],
    ["Fusionne A1:B1.", "sheet.merge_cells", (operation: any) => assert.equal(operation.range, "A1:B1")],
    ["Defusionne A1:B1.", "sheet.unmerge_cells", (operation: any) => assert.equal(operation.range, "A1:B1")],
    ["Ajoute une note \"A verifier\" en B2.", "sheet.set_note", (operation: any) => assert.equal(operation.value, "A verifier")],
    ["Ajoute une liste deroulante \"Oui,Non\" en B2.", "sheet.set_data_validation", (operation: any) => {
      assert.deepEqual(operation.payload.values, ["Oui", "Non"]);
      assert.equal(operation.range, "");
      assert.equal(operation.target.cell, "B2");
    }],
    ["Ajoute un format conditionnel sur A2:B10.", "sheet.add_conditional_format"],
    ["Ajoute un tableau Ventes sur A1:D10.", "sheet.add_table", (operation: any) => assert.equal(operation.range, "A1:D10")],
    ["Ajoute un tableau croise Synthese sur A1:D10.", "sheet.add_pivot_table"],
    ["Ajoute un graphique en ligne sur A1:D10.", "sheet.add_chart", (operation: any) => assert.equal(operation.payload.chartType, "line")],
    ["Ajoute une sparkline sur A2:A10 en E2.", "sheet.add_sparkline", (operation: any) => assert.equal(operation.target.cell, "E2")],
    ["Ajoute un segment Statut.", "sheet.add_slicer", (operation: any) => assert.equal(operation.target.columnName, "Statut")],
    ["Ajoute une plage nommee Ventes sur A1:D10.", "sheet.add_named_range", (operation: any) => assert.equal(operation.title, "Ventes")],
    ["Protege la feuille.", "sheet.protect_sheet"],
    ["Deprotege la feuille.", "sheet.unprotect_sheet"],
    ["Protege la plage A1:B2.", "sheet.protect_range", (operation: any) => assert.equal(operation.range, "A1:B2")],
    ["Fige la premiere ligne et la premiere colonne.", "sheet.freeze_panes", (operation: any) => assert.deepEqual(operation.payload, { rows: 1, columns: 1 })],
    ["Zoom 125%.", "sheet.set_zoom", (operation: any) => assert.equal(operation.value, 125)],
    ["Masque le quadrillage.", "sheet.show_gridlines", (operation: any) => assert.equal(operation.value, false)],
    ["Ajoute une feuille Synthese.", "sheet.add_sheet", (operation: any) => assert.equal(operation.title, "Synthese")],
    ["Renomme la feuille Sheet 1 en Donnees.", "sheet.rename_sheet", (operation: any) => assert.equal(operation.value, "Donnees")],
    ["Duplique la feuille Donnees.", "sheet.duplicate_sheet"],
    ["Masque la feuille Donnees.", "sheet.hide_sheet"],
    ["Affiche la feuille Donnees.", "sheet.unhide_sheet"],
    ["Supprime la feuille Donnees.", "sheet.delete_sheet"]
  ] as const;

  for (const [input, expectedType, check] of cases) {
    const response = await service.ask(publicApiAskRequestSchema.parse({
      ...baseRequest,
      input
    }));
    const operation = (response.proposedActions[0]?.payload.operations as any[])[0];
    assert.equal(response.proposedActions[0]?.type, "workspace_tool_call", input);
    assert.equal(operation?.type, expectedType, input);
    check?.(operation);
  }
});

test("public API v1 can execute confirmed sheet formula operations", async () => {
  let executedAction: any = null;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any,
    workObjectExecutionService: {
      async executeAction(args: any) {
        executedAction = args.action;
        return {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          object: "hydria.work_object_execution",
          createdAt: "2026-05-29T12:00:00.000Z",
          actionId: args.action.id,
          actionType: args.action.type,
          status: "executed",
          dryRun: false,
          confirmed: true,
          issues: [],
          workObject: {
            id: "sheet-1",
            object: "hydria.work_object",
            createdAt: "2026-05-29T12:00:00.000Z",
            updatedAt: "2026-05-29T12:00:00.000Z",
            revision: 2,
            title: "Ventes",
            kind: "dataset",
            status: "updated",
            sessionId,
            userId: null,
            projectId: null,
            workspacePath: "storage/os/work-objects/sheet-1",
            activeEntryPath: "table.csv",
            entries: [],
            artifacts: [],
            summary: "Updated",
            metadata: {},
            history: []
          },
          artifact: null,
          summary: "Applied workspace operation."
        };
      },
      async listWorkObjects() {
        return [];
      },
      async listArtifacts() {
        return [];
      },
      async getWorkObject() {
        return null;
      },
      async readContent() {
        return null;
      },
      async updateContent() {
        return null;
      }
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Applique =B2*C2 en D2.",
      sessionId,
      metadata: {
        workspaceFamilyId: "data_spreadsheet"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "Ventes",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: "{\"kind\":\"hydria-sheet\"}"
        },
        capabilities: {
          actions: ["workspace_tool_call"],
          workspaceTools: ["sheet.apply_formula"],
          workObjectKinds: ["dataset"]
        },
        executionPolicy: {
          mode: "execute_after_confirmation",
          requireConfirmation: false
        }
      }
    })
  );

  assert.equal(response.executedActions.length, 1);
  assert.equal(response.proposedActions[0]?.dryRun, false);
  assert.equal(executedAction.type, "workspace_tool_call");
  assert.equal((executedAction.payload.operations as any[])[0]?.target.cell, "D2");
});

test("public API v1 proposes canonical document workspace tool calls when available", async () => {
  let chatCalls = 0;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        chatCalls += 1;
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Ajoute une section Risques au document actif.",
      metadata: {
        workspaceFamilyId: "document_knowledge"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Brief projet",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "document.html",
          contentPreview: "<h1>Brief projet</h1>"
        },
        capabilities: {
          actions: ["reply", "workspace_tool_call", "update_work_object"],
          workspaceTools: ["doc.edit"],
          artifactFormats: ["docx", "md"],
          workObjectKinds: ["document"]
        }
      }
    })
  );

  assert.equal(chatCalls, 0);
  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(response.proposedActions[0]?.payload.toolName, "doc.edit");
  assert.equal(response.proposedActions[0]?.payload.expectedSurface, "doc");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.type, "doc.insert_section");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.title, "Risques");
});

test("public API v1 accepts OS-style document operation capabilities", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Ajoute une section Risques au document actif.",
      metadata: {
        workspaceFamilyId: "document_knowledge"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          kind: "document",
          title: "Plan",
          workspaceFamilyId: "document_knowledge",
          entryPath: "document.html",
          contentPreview: "<h1>Plan</h1>"
        },
        capabilities: {
          actions: ["workspace_tool_call"],
          workspaceTools: ["doc.insert_section"],
          artifactFormats: ["docx", "md"],
          workObjectKinds: ["document"]
        }
      }
    })
  );

  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(response.proposedActions[0]?.payload.toolName, "doc.edit");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.type, "doc.insert_section");
});

test("public API v1 understands document structure before planning doc edits", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const baseRequest = {
    metadata: {
      workspaceFamilyId: "document_knowledge"
    },
    workspaceContext: {
      activeWorkObject: {
        id: "doc-1",
        kind: "document",
        title: "Plan projet",
        workspaceFamilyId: "document_knowledge",
        entryPath: "content.md",
        contentPreview: [
          "# Plan projet",
          "",
          "## Introduction",
          "",
          "Hydria OS connecte Core au workspace. Les actions doivent rester tracables. Le document garde les decisions.",
          "",
          "## Risques",
          "",
          "- Mauvais routage"
        ].join("\n")
      },
      capabilities: {
        actions: ["workspace_tool_call"],
        workspaceTools: ["doc.edit"],
        artifactFormats: ["docx", "md"],
        workObjectKinds: ["document"]
      }
    }
  } as const;

  const summary = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Raccourcis l'introduction."
  }));
  const summaryOps = summary.proposedActions[0]?.payload.operations as any[];
  assert.equal(summary.proposedActions[0]?.payload.toolName, "doc.edit");
  assert.equal(summaryOps[0]?.type, "doc.replace_block");
  assert.equal(summaryOps[0]?.target.heading, "Introduction");
  assert.match(summaryOps[0]?.content, /Hydria OS/);

  const deletion = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Supprime la section risques."
  }));
  const deletionOps = deletion.proposedActions[0]?.payload.operations as any[];
  assert.equal(deletionOps[0]?.type, "doc.delete_section");
  assert.equal(deletionOps[0]?.target.heading, "Risques");

  const insertion = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Ajoute une section Decisions avec \"Valider le contrat Core OS.\""
  }));
  const insertionOps = insertion.proposedActions[0]?.payload.operations as any[];
  assert.equal(insertionOps[0]?.type, "doc.insert_section");
  assert.equal(insertionOps[0]?.title, "Decisions");
  assert.equal(insertionOps[0]?.content, "Valider le contrat Core OS.");
});

test("public API v1 keeps quoted document edit content instead of model prose", () => {
  const request = publicApiAskRequestSchema.parse({
    input: "Ajoute une section Risques avec 'Verifier les sources avant publication.'",
    options: {
      includeProposedActions: true
    },
    metadata: {
      workspaceFamilyId: "document_knowledge"
    },
    workspaceContext: {
      activeWorkObject: {
        id: "doc-1",
        kind: "document",
        title: "Plan projet",
        workspaceFamilyId: "document_knowledge",
        entryPath: "content.md",
        contentPreview: "# Plan projet\n\n## Introduction\n\nHydria OS connecte Core au workspace."
      },
      capabilities: {
        actions: ["workspace_tool_call"],
        workspaceTools: ["doc.edit"],
        artifactFormats: ["docx", "md"],
        workObjectKinds: ["document"]
      }
    }
  });

  const actions = planPublicApiProposedActions({
    requestId: "request-doc-quoted",
    createdAt: "2026-05-30T12:00:00.000Z",
    request,
    answer: "Ajoutez donc une section Risques avec le texte demande comme recommandation."
  });

  const operation = ((actions[0]?.payload as any).operations as any[])?.[0];
  assert.equal(actions[0]?.type, "workspace_tool_call");
  assert.equal(operation?.type, "doc.insert_section");
  assert.equal(operation?.title, "Risques");
  assert.equal(operation?.content, "Verifier les sources avant publication.");
});

test("public API v1 proposes document table and deletion operations", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const baseRequest = {
    metadata: {
      workspaceFamilyId: "document_knowledge"
    },
    workspaceContext: {
      activeWorkObject: {
        id: "doc-1",
        kind: "document",
        title: "Plan",
        workspaceFamilyId: "document_knowledge",
        entryPath: "document.html",
        contentPreview: "<h1>Plan</h1>"
      },
      capabilities: {
        actions: ["workspace_tool_call"],
        workspaceTools: ["doc.insert_table", "doc.delete_section"],
        artifactFormats: ["docx", "md"],
        workObjectKinds: ["document"]
      }
    }
  } as const;

  const table = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Ajoute un tableau Risques au document actif."
  }));
  assert.equal((table.proposedActions[0]?.payload.operations as any[])[0]?.type, "doc.insert_table");
  assert.equal((table.proposedActions[0]?.payload.operations as any[])[0]?.title, "Risques");

  const deletion = await service.ask(publicApiAskRequestSchema.parse({
    ...baseRequest,
    input: "Supprime la section Risques du document actif."
  }));
  assert.equal((deletion.proposedActions[0]?.payload.operations as any[])[0]?.type, "doc.delete_section");
  assert.equal((deletion.proposedActions[0]?.payload.operations as any[])[0]?.target.heading, "Risques");
});

test("public API v1 proposes canonical slide workspace tool calls when available", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Ajoute une slide Risques dans la presentation.",
      metadata: {
        workspaceFamilyId: "presentation"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "deck-1",
          title: "Comite",
          kind: "presentation",
          workspaceFamilyId: "presentation",
          entryPath: "slides.md",
          contentPreview: "# Comite"
        },
        capabilities: {
          actions: ["workspace_tool_call", "update_work_object"],
          workspaceTools: ["slide.edit"],
          artifactFormats: ["pptx"],
          workObjectKinds: ["presentation"]
        }
      }
    })
  );

  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(response.proposedActions[0]?.payload.toolName, "slide.edit");
  assert.equal(response.proposedActions[0]?.payload.expectedSurface, "slide");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.type, "slide.add");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.title, "Risques");
});

test("public API v1 accepts OS-style slide operation capabilities", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Ajoute une slide Risques dans la presentation.",
      metadata: {
        workspaceFamilyId: "presentation"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "slide-1",
          kind: "presentation",
          title: "Roadmap",
          workspaceFamilyId: "presentation",
          entryPath: "slides.md",
          contentPreview: "# Roadmap"
        },
        capabilities: {
          actions: ["workspace_tool_call", "update_work_object"],
          workspaceTools: ["slide.add"],
          artifactFormats: ["pptx"],
          workObjectKinds: ["presentation"]
        }
      }
    })
  );

  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "workspace_tool_call");
  assert.equal(response.proposedActions[0]?.payload.toolName, "slide.edit");
  assert.equal((response.proposedActions[0]?.payload.operations as any[])[0]?.type, "slide.add");
});

test("public API v1 can materialize confirmed workspace actions into work objects", async () => {
  let executedActionId = "";
  const auditRecords: any[] = [];
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any,
    interactionLogStore: {
      async safeAppend(record: any) {
        auditRecords.push(record);
        return record;
      }
    },
    workObjectExecutionService: {
      async executeAction(args: any) {
        executedActionId = args.action.id;
        assert.equal(args.confirmed, true);
        return {
          id: "66666666-6666-4666-8666-666666666666",
          object: "hydria.work_object_execution",
          createdAt: "2026-05-29T12:00:00.000Z",
          actionId: args.action.id,
          actionType: args.action.type,
          status: "executed",
          dryRun: false,
          confirmed: true,
          issues: [],
          workObject: {
            id: "wo_1",
            object: "hydria.work_object",
            createdAt: "2026-05-29T12:00:00.000Z",
            updatedAt: "2026-05-29T12:00:00.000Z",
            revision: 1,
            title: "Pipeline ventes",
            kind: "dataset",
            status: "ready",
            sessionId,
            userId: null,
            projectId: null,
            workspacePath: "storage/os/work-objects/wo_1",
            activeEntryPath: "table.csv",
            entries: [],
            artifacts: [],
            summary: "Ready",
            metadata: {},
            history: []
          },
          artifact: null,
          summary: "Created work object."
        };
      },
      async listWorkObjects() {
        return [];
      },
      async listArtifacts() {
        return [];
      },
      async getWorkObject() {
        return null;
      },
      async readContent() {
        return null;
      },
      async updateContent() {
        return null;
      }
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Cree un Excel avec les colonnes Client et Status.",
      sessionId,
      workspaceContext: {
        capabilities: {
          actions: ["create_artifact"],
          artifactFormats: ["xlsx", "csv"],
          workObjectKinds: ["dataset"]
        },
        executionPolicy: {
          mode: "execute_after_confirmation",
          requireConfirmation: false
        }
      }
    })
  );

  assert.equal(response.executedActions.length, 1);
  assert.equal(response.executedActions[0]?.status, "executed");
  assert.equal(response.activeWorkObject?.id, "wo_1");
  assert.equal(response.proposedActions[0]?.dryRun, false);
  assert.equal(executedActionId, response.proposedActions[0]?.id);
  assert.equal(auditRecords.length, 2);
  assert.equal(auditRecords[0]?.scope, "workspace_action");
  assert.equal(auditRecords[0]?.artifactId, "wo_1");
  assert.equal(auditRecords[1]?.scope, "public_api_ask");
  assert.equal(auditRecords[1]?.payload.executedActions[0]?.workObjectId, "wo_1");
});

test("public API v1 returns creation proposals when an OS advertises artifact capabilities", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse({
          assistantMessage: {
            content: "Je peux preparer le tableur demande."
          }
        });
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Cree un Excel de suivi des prospects.",
      workspaceContext: {
        capabilities: {
          actions: ["create_artifact"],
          artifactFormats: ["xlsx", "csv"],
          workObjectKinds: ["dataset"]
        }
      }
    })
  );

  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "create_artifact");
  assert.equal(response.proposedActions[0]?.payload.format, "xlsx");
  assert.equal(response.proposedActions[0]?.payload.kind, "dataset");
});

test("public API v1 can create a document proposal from the active sheet", async () => {
  let chatCalls = 0;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        chatCalls += 1;
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Cree un document Word a partir de ce tableau.",
      workspaceContext: {
        activeWorkObject: {
          id: "sheet-1",
          title: "CA mensuel",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: JSON.stringify({
            kind: "hydria-sheet",
            activeSheetId: "sheet-1",
            sheets: [
              {
                id: "sheet-1",
                columns: ["Mois", "CA"],
                rows: [["Janvier", "1200"], ["Fevrier", "1600"]]
              }
            ]
          })
        },
        capabilities: {
          actions: ["create_artifact", "reply"],
          artifactFormats: ["docx", "md"],
          workObjectKinds: ["dataset", "document"]
        }
      }
    })
  );

  assert.equal(chatCalls, 0);
  assert.equal(response.proposedActions[0]?.type, "create_artifact");
  assert.equal(response.proposedActions[0]?.payload.kind, "document");
  assert.equal(response.proposedActions[0]?.payload.workspaceFamilyId, "document_knowledge");
  assert.match(String(response.proposedActions[0]?.payload.answerDraft), /1600/);
});

test("public API v1 can create a sheet proposal from the active document", async () => {
  let chatCalls = 0;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        chatCalls += 1;
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Cree un Excel a partir de ce document.",
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "CA note",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# CA note\n\nJanvier: 1200\nFevrier: 1600"
        },
        capabilities: {
          actions: ["create_artifact", "reply"],
          artifactFormats: ["xlsx", "csv"],
          workObjectKinds: ["dataset", "document"]
        }
      }
    })
  );

  assert.equal(chatCalls, 0);
  assert.equal(response.proposedActions[0]?.type, "create_artifact");
  assert.equal(response.proposedActions[0]?.payload.kind, "dataset");
  assert.equal(response.proposedActions[0]?.payload.workspaceFamilyId, "data_spreadsheet");
  assert.match(JSON.stringify(response.proposedActions[0]?.payload.rows), /1600/);
});

test("public API v1 plans Word document workspace actions on deterministic fast path", async () => {
  let chatCalls = 0;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        chatCalls += 1;
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Ajoute une section Risques au document actif.",
      metadata: {
        workspaceFamilyId: "document_knowledge"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Brief projet",
          kind: "document",
          entryPath: "brief.md",
          contentPreview: "# Brief"
        },
        capabilities: {
          actions: ["reply", "update_work_object", "create_artifact"],
          artifactFormats: ["docx", "md"],
          workObjectKinds: ["document"]
        }
      }
    })
  );

  assert.equal(chatCalls, 0);
  assert.equal(response.models.provider, "policy");
  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "update_work_object");
  assert.equal(response.proposedActions[0]?.target.workObjectId, "doc-1");
  assert.equal(response.proposedActions[0]?.payload.mode, "append");
  assert.equal(response.proposedActions[0]?.payload.workspaceFamilyId, "document_knowledge");
});

test("public API v1 can shadow Office workspace actions without changing the official response", async () => {
  let shadowCalls = 0;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        throw new Error("fast path should not call chat runtime");
      },
      resetSession() {}
    } as any,
    officeWorkspaceShadowEnabled: true,
    officeWorkspaceShadowService: {
      async run(args: any) {
        shadowCalls += 1;
        assert.equal(args.official.models.model, "workspace_action_planner_v1");
        assert.equal(args.official.proposedActions[0]?.type, "update_work_object");
      }
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Ajoute une section Risques au document actif.",
      metadata: {
        workspaceFamilyId: "document_knowledge"
      },
      workspaceContext: {
        activeWorkObject: {
          id: "doc-1",
          title: "Brief projet",
          kind: "document",
          entryPath: "brief.md",
          contentPreview: "# Brief"
        },
        capabilities: {
          actions: ["reply", "update_work_object"],
          artifactFormats: ["docx", "md"],
          workObjectKinds: ["document"]
        }
      }
    })
  );

  assert.equal(response.models.model, "workspace_action_planner_v1");
  assert.equal(response.proposedActions[0]?.target.workObjectId, "doc-1");
  assert.equal(shadowCalls, 1);
});

test("public API v1 does not shadow non-workspace questions", async () => {
  let shadowCalls = 0;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse();
      },
      resetSession() {}
    } as any,
    officeWorkspaceShadowEnabled: true,
    officeWorkspaceShadowService: {
      async run() {
        shadowCalls += 1;
      }
    } as any
  });

  await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Qu'est-ce que NVIDIA ?"
    })
  );

  assert.equal(shadowCalls, 0);
});

test("public API v1 does not fast-path source-sensitive Word document requests", async () => {
  let chatCalls = 0;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        chatCalls += 1;
        return chatResponse({
          assistantMessage: {
            content: "Louis IX etait un roi de France; je prepare un document source apres analyse."
          },
          generation: {
            provider: "ollama",
            model: "gemma3n:e4b",
            specialist: {
              role: "source_backed_runtime"
            },
            attempts: [{ model: "gemma3n:e4b" }]
          }
        });
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Redige une biographie de Louis IX de France dans un document Word.",
      metadata: {
        workspaceFamilyId: "document_knowledge"
      },
      workspaceContext: {
        capabilities: {
          actions: ["reply", "create_artifact"],
          artifactFormats: ["docx", "md"],
          workObjectKinds: ["document"]
        }
      }
    })
  );

  assert.equal(chatCalls, 1);
  assert.equal(response.models.provider, "ollama");
  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0]?.type, "create_artifact");
  assert.equal(response.proposedActions[0]?.payload.format, "docx");
  assert.equal(response.proposedActions[0]?.payload.kind, "document");
  assert.equal(response.proposedActions[0]?.payload.workspaceFamilyId, "document_knowledge");
});

test("public API v1 can include trace and diagnostics without exposing private chain-of-thought", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      question: "Qu'est-ce que NVIDIA ?",
      options: {
        includeTrace: true,
        includeDiagnostics: true
      }
    })
  );

  assert.equal((response.trace as any).disclosure, "runtime_trace_no_private_chain_of_thought");
  assert.equal((response.diagnostics as any).agenticPlan.mode, "evidence_first");
});

test("public API v1 lists persisted interaction audit records for OS memory", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse();
      },
      resetSession() {}
    } as any,
    interactionLogStore: {
      async safeAppend() {
        return null;
      },
      async listRecent() {
        return [
          {
            id: "77777777-7777-4777-8777-777777777777",
            createdAt: "2026-05-30T12:00:00.000Z",
            scope: "workspace_action",
            source: "public_api",
            mode: "chat",
            status: "completed",
            sessionId,
            artifactId: "wo_1",
            question: "Fais le total.",
            answer: "Applied 1 workspace operation.",
            summary: "Applied 1 workspace operation.",
            routing: {
              orchestrator: "hydria_public_api_v1",
              provider: "workspace",
              model: "sheet.apply_formula",
              category: "workspace_action",
              toolUsed: true
            },
            quality: {
              passed: true,
              score: 1,
              issues: []
            },
            durationMs: null,
            payload: null
          },
          {
            id: "88888888-8888-4888-8888-888888888888",
            createdAt: "2026-05-30T12:01:00.000Z",
            scope: "public_api_ask",
            source: "public_api",
            mode: "chat",
            status: "completed",
            sessionId: "other-session",
            artifactId: null,
            question: "Qu'est-ce que NVIDIA ?",
            answer: "NVIDIA est une entreprise.",
            summary: "NVIDIA est une entreprise.",
            routing: {
              orchestrator: "hydria_public_api_v1",
              provider: "tool",
              model: "research_fact_check",
              category: "technical_explanation",
              toolUsed: true
            },
            quality: {
              passed: true,
              score: 0.9,
              issues: []
            },
            durationMs: 10,
            payload: null
          }
        ] as any[];
      }
    }
  });

  const interactions = await service.listInteractions({ sessionId, scope: "workspace_action" });
  assert.equal(interactions.length, 1);
  assert.equal(interactions[0]?.scope, "workspace_action");
  assert.equal(interactions[0]?.artifactId, "wo_1");
});

test("public API v1 creates and resets sessions", () => {
  let resetId = "";
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse();
      },
      resetSession(id: string) {
        resetId = id;
      }
    } as any
  });

  const session = service.createSession();
  assert.equal(session.object, "hydria.session");
  assert.match(session.id, /^[0-9a-f-]{36}$/);

  const reset = service.resetSession(sessionId);
  assert.equal(reset.object, "hydria.session_reset");
  assert.equal(reset.reset, true);
  assert.equal(resetId, sessionId);
});

test("public API v1 exposes integration capabilities", () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const capabilities = service.capabilities();
  assert.equal(capabilities.version, "v1");
  assert.ok(capabilities.endpoints.includes("POST /api/v1/ask"));
  assert.ok(capabilities.endpoints.includes("GET /api/v1/interactions"));
  assert.ok(capabilities.runtime.orchestration.includes("agentic mission plan"));
  assert.ok(capabilities.runtime.orchestration.includes("workspace action proposals"));
  assert.equal(capabilities.runtime.chainOfThought, "not_exposed");
});
