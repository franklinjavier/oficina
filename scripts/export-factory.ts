import { exportFactory, parseArgs, usageText } from "./lib/export-factory.ts";

function printError(error: { kind: string; message: string; findings?: string[] }): void {
  console.error(error.message);
  if (error.kind === "credentials" && error.findings && error.findings.length > 0) {
    for (const finding of error.findings) {
      console.error(`- ${finding}`);
    }
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
      console.log(usageText());
      return 0;
    }
    printError(parsed.error);
    return parsed.error.kind === "usage" ? 2 : 1;
  }

  const result = await exportFactory(parsed.data);
  if (!result.ok) {
    printError(result.error);
    return result.error.kind === "usage" ? 2 : 1;
  }

  const report = result.data;
  if (report.dryRun) {
    console.log(`Dry-run ${report.type} ${report.name}`);
  } else {
    console.log(`Wrote ${report.type} ${report.name}`);
  }
  console.log(`Agents: ${report.agents.join(", ")}`);
  for (const file of report.files) {
    console.log(`${file.path} -> ${file.target}`);
  }
  console.log("");
  console.log("This tool only wrote local registry source. Publish from YOUR public GitHub repo:");
  console.log(`  1. Commit registry.json and registry/${report.name}/`);
  console.log("  2. Push to your public repository");
  console.log(`  3. A friend installs with: npx shadcn@latest add <owner>/<repo>/${report.name}`);
  console.log("     Run that from the directory that should receive oficina/bots/");
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Export failed";
    console.error(message);
    process.exit(1);
  });
