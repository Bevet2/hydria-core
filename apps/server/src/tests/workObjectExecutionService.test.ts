import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkObjectExecutionService } from "../services/workObjects/workObjectExecutionService.js";
import { publicApiProposedActionSchema, type PublicApiProposedAction } from "../types/publicApi.js";

async function withTempService(callback: (service: WorkObjectExecutionService) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "hydria-work-objects-"));
  try {
    const service = new WorkObjectExecutionService({
      storeFile: join(root, "store.json"),
      objectRootDir: join(root, "objects"),
      artifactRootDir: join(root, "artifacts")
    });
    await callback(service);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function action(partial: Partial<PublicApiProposedAction>): PublicApiProposedAction {
  return publicApiProposedActionSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    type: "create_artifact",
    title: "Creer un document",
    target: {
      workObjectId: null,
      entryPath: null
    },
    payload: {
      instruction: "Cree un document Word sur Louis IX.",
      format: "docx",
      kind: "document",
      answerDraft: "Louis IX, dit Saint Louis, est un roi de France du XIIIe siecle."
    },
    riskLevel: "low",
    requiresConfirmation: true,
    dryRun: true,
    rationale: "Create a persistent work object.",
    provenance: {
      source: "hydria_core_public_api_v1",
      requestId: "22222222-2222-4222-8222-222222222222",
      generatedAt: "2026-05-29T12:00:00.000Z"
    },
    ...partial
  });
}

test("work object execution requires confirmation for risky OS actions", async () => {
  await withTempService(async (service) => {
    const result = await service.executeAction({
      action: action({}),
      confirmed: false,
      sessionId: "33333333-3333-4333-8333-333333333333"
    });

    assert.equal(result.status, "requires_confirmation");
    assert.equal(result.dryRun, true);
    assert.equal(result.workObject, null);
    assert.deepEqual(await service.listWorkObjects(), []);
  });
});

test("work object execution creates a persistent editable document and export artifact", async () => {
  await withTempService(async (service) => {
    const result = await service.executeAction({
      action: action({}),
      confirmed: true,
      sessionId: "33333333-3333-4333-8333-333333333333",
      userId: "user-1",
      projectId: "project-1"
    });

    assert.equal(result.status, "executed");
    assert.equal(result.dryRun, false);
    assert.equal(result.workObject?.kind, "document");
    assert.equal(result.artifact?.object, "hydria.artifact");
    assert.equal(result.artifact?.format, "docx");
    assert.match(result.artifact?.downloadUrl ?? "", /\/api\/v1\/artifacts\/.+\/download/);
    const artifactContent = await service.readArtifactContent(result.artifact!.id);
    assert.equal(artifactContent?.contentType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.equal(artifactContent?.buffer.subarray(0, 2).toString("utf8"), "PK");

    const listed = await service.listWorkObjects({ sessionId: "33333333-3333-4333-8333-333333333333" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.revision, 1);

    const content = await service.readContent(listed[0]!.id, listed[0]!.activeEntryPath);
    assert.match(content?.content ?? "", /Louis IX/);
    assert.equal(listed[0]?.activeEntryPath, "document.html");
    assert.ok(listed[0]?.entries.some((entry) => entry.path === "spec.json"));
  });
});

test("work object execution materializes extracted spreadsheet rows", async () => {
  await withTempService(async (service) => {
    const result = await service.executeAction({
      action: action({
        type: "create_artifact",
        title: "Creer un Excel depuis des chiffres",
        payload: {
          instruction: "Presente ces chiffres dans un Excel.",
          format: "xlsx",
          kind: "dataset",
          columns: ["Libelle", "Valeur", "Unite"],
          rows: [
            ["Janvier", "1200", "€"],
            ["Fevrier", "1600", "€"],
            ["Mars", "1400", "€"]
          ]
        }
      }),
      confirmed: true,
      sessionId: "33333333-3333-4333-8333-333333333333"
    });

    assert.equal(result.status, "executed");
    assert.equal(result.workObject?.kind, "dataset");
    assert.equal(result.artifact?.format, "xlsx");
    const content = await service.readContent(result.workObject!.id, "table.csv");
    const model = JSON.parse(content?.content ?? "{}");
    assert.deepEqual(model.sheets[0].columns, ["Libelle", "Valeur", "Unite"]);
    assert.deepEqual(model.sheets[0].rows, [
      ["Janvier", "1200", "€"],
      ["Fevrier", "1600", "€"],
      ["Mars", "1400", "€"]
    ]);
  });
});

test("work object execution updates a dataset by adding requested columns", async () => {
  await withTempService(async (service) => {
    const createResult = await service.executeAction({
      action: action({
        id: "44444444-4444-4444-8444-444444444444",
        type: "create_artifact",
        title: "Creer un tableur",
        payload: {
          instruction: "Cree un Excel de suivi.",
          format: "xlsx",
          kind: "dataset",
          columns: ["Client", "Status"]
        }
      }),
      confirmed: true
    });

    const workObjectId = createResult.workObject!.id;
    assert.equal(createResult.artifact?.format, "xlsx");
    const xlsxArtifact = await service.readArtifactContent(createResult.artifact!.id);
    assert.equal(xlsxArtifact?.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(xlsxArtifact?.buffer.subarray(0, 2).toString("utf8"), "PK");
    const updateResult = await service.executeAction({
      action: action({
        id: "55555555-5555-4555-8555-555555555555",
        type: "update_work_object",
        title: "Modifier le tableur",
        target: {
          workObjectId,
          entryPath: "table.csv"
        },
        payload: {
          instruction: "Ajoute une colonne Priorite dans le tableur.",
          mode: "append",
          currentKind: "dataset",
          columns: ["Priorite"]
        },
        riskLevel: "medium"
      }),
      confirmed: true
    });

    assert.equal(updateResult.status, "executed");
    assert.equal(updateResult.workObject?.revision, 2);
    const content = await service.readContent(workObjectId, "table.csv");
    const sheet = JSON.parse(content?.content ?? "{}");
    assert.equal(sheet.kind, "hydria-sheet");
    assert.deepEqual(sheet.sheets[0].columns, ["Client", "Status", "Priorite"]);
    assert.deepEqual(sheet.columns, ["Client", "Status", "Priorite"]);
    assert.ok(updateResult.workObject?.entries.some((entry) => entry.path === "spec.json"));
  });
});

test("work object execution applies sheet workspace tool formulas", async () => {
  await withTempService(async (service) => {
    const createResult = await service.executeAction({
      action: action({
        id: "88888888-8888-4888-8888-888888888888",
        type: "create_artifact",
        title: "Creer un tableur",
        payload: {
          instruction: "Cree un Excel de ventes.",
          format: "xlsx",
          kind: "dataset",
          columns: ["Prix", "Quantite"]
        }
      }),
      confirmed: true
    });

    const workObjectId = createResult.workObject!.id;
    const operationResult = await service.executeAction({
      action: action({
        id: "99999999-9999-4999-8999-999999999999",
        type: "workspace_tool_call",
        title: "Appliquer une formule",
        target: {
          workObjectId,
          entryPath: "table.csv"
        },
        payload: {
          instruction: "Ajoute une colonne Total avec la formule =A2*B2.",
          toolName: "sheet.apply_formula",
          operations: [
            {
              type: "sheet.add_column",
              columnName: "Total",
              formula: "=A2*B2",
              target: {
                columnName: "Total",
                rowIndex: 0
              }
            }
          ]
        },
        riskLevel: "medium"
      }),
      confirmed: true
    });

    assert.equal(operationResult.status, "executed");
    assert.equal(operationResult.workObject?.revision, 2);
    const content = await service.readContent(workObjectId, "table.csv");
    const sheet = JSON.parse(content?.content ?? "{}");
    assert.deepEqual(sheet.sheets[0].columns, ["Prix", "Quantite", "Total"]);
    assert.equal(sheet.sheets[0].rows[0][2], "=A2*B2");
    assert.equal((operationResult.workObject?.history.at(-1)?.payload as any)?.toolName, "sheet.apply_formula");
  });
});

test("work object execution applies rich Sheet workspace tool operations", async () => {
  await withTempService(async (service) => {
    const createResult = await service.executeAction({
      action: action({
        id: "14141414-1414-4414-8414-141414141414",
        type: "create_artifact",
        title: "Creer un tableur",
        payload: {
          instruction: "Cree un Excel de ventes.",
          format: "xlsx",
          kind: "dataset",
          columns: ["Prix", "Quantite"]
        }
      }),
      confirmed: true
    });

    const workObjectId = createResult.workObject!.id;
    const operationResult = await service.executeAction({
      action: action({
        id: "15151515-1515-4515-8515-151515151515",
        type: "workspace_tool_call",
        title: "Modifier tableur",
        target: {
          workObjectId,
          entryPath: "table.csv"
        },
        payload: {
          instruction: "Renomme, ajoute des lignes, trie, filtre, formate puis supprime.",
          toolName: "sheet.apply_formula",
          operations: [
            {
              type: "sheet.rename_column",
              target: { columnName: "Prix" },
              value: "Prix HT"
            },
            {
              type: "sheet.add_row",
              values: ["20", "2"]
            },
            {
              type: "sheet.add_row",
              values: ["10", "1"]
            },
            {
              type: "sheet.sort_range",
              target: { columnName: "Prix HT" },
              direction: "asc"
            },
            {
              type: "sheet.filter_rows",
              target: { columnName: "Prix HT" },
              value: "10"
            },
            {
              type: "sheet.format_cells",
              target: { columnName: "Prix HT" },
              format: {
                numberFormat: "currency",
                bold: true
              }
            },
            {
              type: "sheet.delete_row",
              target: { rowIndex: 0 }
            },
            {
              type: "sheet.delete_column",
              target: { columnName: "Quantite" }
            }
          ]
        },
        riskLevel: "medium"
      }),
      confirmed: true
    });

    assert.equal(operationResult.status, "executed");
    const content = await service.readContent(workObjectId, "table.csv");
    const sheet = JSON.parse(content?.content ?? "{}");
    assert.deepEqual(sheet.sheets[0].columns, ["Prix HT"]);
    assert.deepEqual(sheet.sheets[0].rows.map((row: string[]) => row[0]), ["10", "20"]);
    assert.equal(sheet.sheets[0].filterColumnIndex, 0);
    assert.equal(sheet.sheets[0].filterQuery, "10");
    assert.deepEqual(sheet.sheets[0].sort, { columnIndex: 0, direction: "asc" });
    assert.equal(sheet.sheets[0].cellFormats["0:0"].numberFormat, "currency");
    assert.equal(sheet.sheets[0].cellFormats["0:0"].bold, true);
  });
});

test("work object execution applies broad Sheet workspace operations", async () => {
  await withTempService(async (service) => {
    const createResult = await service.executeAction({
      action: action({
        id: "18181818-1818-4818-8818-181818181818",
        type: "create_artifact",
        title: "Creer un tableur",
        payload: {
          instruction: "Cree un Excel de ventes.",
          format: "xlsx",
          kind: "dataset",
          columns: ["Prix", "Quantite"]
        }
      }),
      confirmed: true
    });

    const workObjectId = createResult.workObject!.id;
    const operationResult = await service.executeAction({
      action: action({
        id: "19191919-1919-4919-8919-191919191919",
        type: "workspace_tool_call",
        title: "Operations tableur completes",
        target: {
          workObjectId,
          entryPath: "table.csv"
        },
        payload: {
          instruction: "Applique operations Sheet avancees.",
          toolName: "sheet.apply_formula",
          operations: [
            { type: "sheet.insert_rows", target: { rowIndex: 1 }, count: 1 },
            { type: "sheet.insert_columns", target: { columnIndex: 1 }, count: 1, values: ["Remise"] },
            { type: "sheet.set_range", range: "B2:C2", values: [["5", "2"]] },
            { type: "sheet.merge_cells", range: "A2:B2" },
            { type: "sheet.set_note", target: { cell: "A2" }, value: "Prix client" },
            { type: "sheet.set_data_validation", range: "B2:B5", payload: { type: "number" } },
            { type: "sheet.add_conditional_format", range: "A2:A5", payload: { rule: "greaterThan", value: 10 } },
            { type: "sheet.add_table", title: "Ventes", range: "A1:C5" },
            { type: "sheet.add_chart", title: "CA", payload: { kind: "bar", range: "A1:C5" } },
            { type: "sheet.add_named_range", title: "PrixRange", range: "A2:A5" },
            { type: "sheet.freeze_panes", payload: { rows: 1, columns: 1 } },
            { type: "sheet.protect_sheet" },
            { type: "sheet.add_sheet", title: "Synthese" }
          ]
        },
        riskLevel: "medium"
      }),
      confirmed: true
    });

    assert.equal(operationResult.status, "executed");
    const content = await service.readContent(workObjectId, "table.csv");
    const workbook = JSON.parse(content?.content ?? "{}");
    assert.equal(workbook.sheets[0].columns[1], "Remise");
    assert.equal(workbook.sheets[0].merges[0].range, "A2:B2");
    assert.equal(workbook.sheets[0].cellNotes["1:0"], "Prix client");
    assert.equal(workbook.sheets[0].tables[0].title, "Ventes");
    assert.equal(workbook.sheets[0].charts[0].title, "CA");
    assert.equal(workbook.namedRanges[0].name, "PrixRange");
    assert.equal(workbook.sheets[0].frozenRows, 1);
    assert.equal(workbook.sheets[0].protected, true);
    assert.equal(workbook.sheets[1].name, "Synthese");
  });
});

test("work object execution applies document workspace tool operations", async () => {
  await withTempService(async (service) => {
    const createResult = await service.executeAction({
      action: action({
        id: "12121212-1212-4212-8212-121212121212",
        type: "create_artifact",
        title: "Creer un document",
        payload: {
          instruction: "Cree un document projet.",
          format: "docx",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          answerDraft: "Brief initial."
        }
      }),
      confirmed: true
    });

    const workObjectId = createResult.workObject!.id;
    const operationResult = await service.executeAction({
      action: action({
        id: "13131313-1313-4313-8313-131313131313",
        type: "workspace_tool_call",
        title: "Ajouter section",
        target: {
          workObjectId,
          entryPath: "document.html"
        },
        payload: {
          instruction: "Ajoute une section Risques.",
          toolName: "doc.edit",
          operations: [
            {
              type: "doc.insert_section",
              title: "Risques",
              content: "Lister les risques principaux."
            }
          ]
        },
        riskLevel: "medium"
      }),
      confirmed: true
    });

    assert.equal(operationResult.status, "executed");
    const content = await service.readContent(workObjectId, "document.html");
    assert.match(content?.content ?? "", /<h2>Risques<\/h2>/);
    assert.match(content?.content ?? "", /Lister les risques principaux/);
  });
});

test("work object execution applies document table insertion and section deletion", async () => {
  await withTempService(async (service) => {
    const createResult = await service.executeAction({
      action: action({
        id: "16161616-1616-4616-8616-161616161616",
        type: "create_artifact",
        title: "Creer un document",
        payload: {
          instruction: "Cree un document projet.",
          format: "docx",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          answerDraft: "Plan initial."
        }
      }),
      confirmed: true
    });

    const workObjectId = createResult.workObject!.id;
    const operationResult = await service.executeAction({
      action: action({
        id: "17171717-1717-4717-8717-171717171717",
        type: "workspace_tool_call",
        title: "Modifier document",
        target: {
          workObjectId,
          entryPath: "document.html"
        },
        payload: {
          instruction: "Supprime Risques et ajoute un tableau Decisions.",
          toolName: "doc.edit",
          operations: [
            {
              type: "doc.insert_section",
              title: "Risques",
              content: "A supprimer."
            },
            {
              type: "doc.delete_section",
              title: "Risques",
              target: { heading: "Risques" }
            },
            {
              type: "doc.insert_table",
              title: "Decisions",
              values: [
                ["Decision", "Owner"],
                ["Migration progressive", "Core"]
              ]
            }
          ]
        },
        riskLevel: "medium"
      }),
      confirmed: true
    });

    assert.equal(operationResult.status, "executed");
    const content = await service.readContent(workObjectId, "document.html");
    assert.doesNotMatch(content?.content ?? "", /A supprimer/);
    assert.match(content?.content ?? "", /<h2>Decisions<\/h2>/);
    assert.match(content?.content ?? "", /<table>/);
    assert.match(content?.content ?? "", /Migration progressive/);
  });
});

test("work object execution applies broad document workspace operations", async () => {
  await withTempService(async (service) => {
    const createResult = await service.executeAction({
      action: action({
        id: "20202020-2020-4020-8020-202020202020",
        type: "create_artifact",
        title: "Creer un document",
        payload: {
          instruction: "Cree un document projet.",
          format: "docx",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          answerDraft: "Initial title\n\nOld text"
        }
      }),
      confirmed: true
    });

    const workObjectId = createResult.workObject!.id;
    await service.executeAction({
      action: action({
        id: "21212121-2121-4121-8121-212121212121",
        type: "workspace_tool_call",
        title: "Operations document completes",
        target: {
          workObjectId,
          entryPath: "document.html"
        },
        payload: {
          instruction: "Applique operations Doc avancees.",
          toolName: "doc.edit",
          operations: [
            { type: "doc.set_title", title: "New title" },
            { type: "doc.insert_heading", title: "Scope", target: { level: 2 } },
            { type: "doc.insert_paragraph", content: "Paragraph content." },
            { type: "doc.insert_list", values: ["One", "Two"] },
            { type: "doc.insert_link", title: "Hydria", value: "https://app.hydria.click" },
            { type: "doc.insert_quote", content: "A governed workspace action." },
            { type: "doc.insert_code_block", content: "const ok = true;", payload: { language: "js" } },
            { type: "doc.replace_text", target: { oldText: "Old text" }, content: "New text" },
            { type: "doc.add_comment", title: "review", content: "Check wording." }
          ]
        },
        riskLevel: "medium"
      }),
      confirmed: true
    });

    const content = await service.readContent(workObjectId, "document.html");
    assert.match(content?.content ?? "", /<h1>New title<\/h1>/);
    assert.match(content?.content ?? "", /<h2>Scope<\/h2>/);
    assert.match(content?.content ?? "", /<li>One<\/li>/);
    assert.match(content?.content ?? "", /href="https:\/\/app\.hydria\.click"/);
    assert.match(content?.content ?? "", /New text/);
    assert.match(content?.content ?? "", /hydria-add_comment/);
  });
});

test("work object execution applies slide workspace tool operations", async () => {
  await withTempService(async (service) => {
    const createResult = await service.executeAction({
      action: action({
        id: "14141414-1414-4414-8414-141414141414",
        type: "create_artifact",
        title: "Creer une presentation",
        payload: {
          instruction: "Cree une presentation projet.",
          format: "pptx",
          kind: "presentation",
          sections: ["Contexte"]
        }
      }),
      confirmed: true
    });

    const workObjectId = createResult.workObject!.id;
    const operationResult = await service.executeAction({
      action: action({
        id: "15151515-1515-4515-8515-151515151515",
        type: "workspace_tool_call",
        title: "Ajouter slide",
        target: {
          workObjectId,
          entryPath: "slides.md"
        },
        payload: {
          instruction: "Ajoute une slide Risques.",
          toolName: "slide.edit",
          operations: [
            {
              type: "slide.add",
              title: "Risques",
              bullets: ["Risque budget", "Risque planning"]
            }
          ]
        },
        riskLevel: "medium"
      }),
      confirmed: true
    });

    assert.equal(operationResult.status, "executed");
    const content = await service.readContent(workObjectId, "slides.md");
    assert.match(content?.content ?? "", /Slide 2 - Risques/);
    assert.match(content?.content ?? "", /Risque budget/);
  });
});

test("work object execution exports presentations as pptx binaries", async () => {
  await withTempService(async (service) => {
    const result = await service.executeAction({
      action: action({
        id: "77777777-7777-4777-8777-777777777777",
        type: "create_artifact",
        title: "Creer une presentation",
        payload: {
          instruction: "Cree une presentation de lancement produit.",
          format: "pptx",
          kind: "presentation",
          sections: ["Contexte", "Plan", "Risques"]
        }
      }),
      confirmed: true
    });

    assert.equal(result.status, "executed");
    assert.equal(result.workObject?.kind, "presentation");
    assert.equal(result.artifact?.format, "pptx");
    const artifactContent = await service.readArtifactContent(result.artifact!.id);
    assert.equal(artifactContent?.contentType, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    assert.equal(artifactContent?.buffer.subarray(0, 2).toString("utf8"), "PK");
  });
});
