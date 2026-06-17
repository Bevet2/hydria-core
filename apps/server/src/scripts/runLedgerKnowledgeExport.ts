import { LedgerKnowledgeExporter } from "../services/research/ledgerKnowledgeExporter.js";

const force = process.argv.includes("--force");
const exporter = new LedgerKnowledgeExporter();

const result = force
  ? await exporter.runExport()
  : await (async () => {
      await exporter.maybeExport();
      return null;
    })();

if (result !== null) {
  console.log(`Ledger export complete — ${result.exported} knowledge object(s) upserted to vault.`);
} else {
  console.log("No export triggered (not enough new ledger entries). Use --force to override.");
}
