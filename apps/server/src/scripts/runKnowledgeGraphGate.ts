import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  knowledgeGraphGateCases,
  knowledgeGraphGateEdges,
  knowledgeGraphGateNodes
} from "../data/knowledgeGraphGatePack.js";
import { HybridKnowledgeRetrievalService } from "../services/knowledge/hybridKnowledgeRetrievalService.js";
import { KnowledgeGraphStore } from "../services/knowledge/knowledgeGraphStore.js";

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "knowledge-graph-gate-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput)
  };
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runKnowledgeGraphGate(args = parseArgs()) {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-graph-gate-"));
  try {
    const graphStore = new KnowledgeGraphStore(join(tempRoot, "graph.json"));
    const graphFile = await graphStore.save({
      nodes: knowledgeGraphGateNodes,
      edges: knowledgeGraphGateEdges
    });
    const reloaded = await graphStore.load();
    const retrieval = new HybridKnowledgeRetrievalService({
      knowledgeGraphStore: graphStore,
      minHybridScore: 0.28
    });
    const kindCoverage = new Set(graphFile.nodes.map((node) => node.kind));
    const edgeKindCoverage = new Set(graphFile.edges.map((edge) => edge.kind));
    const results = [];

    for (const testCase of knowledgeGraphGateCases) {
      const result = await retrieval.retrieve({ query: testCase.query, limit: 3 });
      const top = result.hits[0] ?? null;
      const matchedTermsText = normalize((top?.matchedTerms ?? []).join(" "));
      const issues: string[] = [];
      if (!top) {
        issues.push("missing_top_hit");
      } else {
        if (!testCase.expectedTopNodeIds.includes(top.nodeId)) {
          issues.push(`unexpected_top_node:${top.nodeId}`);
        }
        if (!testCase.expectedKinds.includes(top.kind)) {
          issues.push(`unexpected_top_kind:${top.kind}`);
        }
        for (const term of testCase.expectedMatchedTerms) {
          if (!matchedTermsText.includes(normalize(term))) {
            issues.push(`missing_matched_term:${term}`);
          }
        }
        if (top.evidencePaths.length === 0 || top.evidencePaths[0]?.edgeIds.length === 0) {
          issues.push("missing_graph_evidence_path");
        }
        if (top.vectorScore <= 0 || top.lexicalScore <= 0) {
          issues.push("missing_lexical_vector_score");
        }
      }
      results.push({
        id: testCase.id,
        passed: issues.length === 0,
        issues,
        reason: testCase.reason,
        query: testCase.query,
        topHit: top,
        hitCount: result.hitCount
      });
    }

    const requiredNodeKinds = ["concept", "source", "tool", "skill", "agent", "decision"];
    const requiredEdgeKinds = ["derived_from", "uses_skill", "related_to"];
    const coverageIssues = [
      ...requiredNodeKinds
        .filter((kind) => !kindCoverage.has(kind as typeof knowledgeGraphGateNodes[number]["kind"]))
        .map((kind) => `missing_node_kind:${kind}`),
      ...requiredEdgeKinds
        .filter((kind) => !edgeKindCoverage.has(kind as typeof knowledgeGraphGateEdges[number]["kind"]))
        .map((kind) => `missing_edge_kind:${kind}`)
    ];
    if (!reloaded || reloaded.nodes.length !== graphFile.nodes.length || reloaded.edges.length !== graphFile.edges.length) {
      coverageIssues.push("persistence_reload_failed");
    }
    const failed = results.filter((result) => !result.passed);
    const report = {
      version: "hydria-knowledge-graph-gate-v1",
      generatedAt: new Date().toISOString(),
      passed: failed.length === 0 && coverageIssues.length === 0,
      summary: {
        caseCount: results.length,
        passedCases: results.length - failed.length,
        failedCases: failed.length,
        nodeCount: graphFile.stats.nodeCount,
        edgeCount: graphFile.stats.edgeCount,
        nodeKinds: [...kindCoverage].sort(),
        edgeKinds: [...edgeKindCoverage].sort(),
        coverageIssues
      },
      failedCaseIds: failed.map((result) => result.id),
      results
    };
    await writeJson(args.output, report);
    return report;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? "") === currentFilePath) {
  runKnowledgeGraphGate()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            passed: report.passed,
            summary: report.summary,
            failedCaseIds: report.failedCaseIds,
            output: parseArgs().output
          },
          null,
          2
        )
      );
      if (!report.passed) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
