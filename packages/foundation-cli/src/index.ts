import os from "node:os";
import path from "node:path";
import { Command, Option } from "commander";
import { doctorFoundation, type DoctorReport } from "./doctor.js";
import { inspectMachine, type MachineInspection } from "./inspection.js";
import {
  applyInstallPlan,
  recoverInterruptedInstall,
  rollbackInstall,
  uninstallFoundation,
} from "./install.js";
import { createInstallPlan, readInstallPlan, writeInstallPlan } from "./plan.js";
import { installRoleBoundaryReceipt } from "./qualification.js";
import type { InstallMode, InstallPlan, InstallRecord } from "./schema.js";
import { resolveFoundationCliVersion } from "./version.js";

interface CommonOptions {
  home?: string;
  productRoot?: string;
  json?: boolean;
}

interface PlanOptions extends CommonOptions {
  mode: InstallMode;
  output?: string;
  withControlWorkspace?: boolean;
  withoutControlWorkspace?: boolean;
}

interface ApplyOptions {
  plan: string;
  json?: boolean;
}

interface DoctorOptions extends CommonOptions {
  project?: string;
  roleCanary?: string;
}

interface RecordRoleCanaryOptions extends CommonOptions {
  receipt: string;
}

function resolvedHome(home?: string): string {
  return path.resolve(home ?? os.homedir());
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printInspection(inspection: MachineInspection): void {
  process.stdout.write(`Foundation ${inspection.distributionVersion}\n`);
  process.stdout.write(`Host ${inspection.platform}/${inspection.architecture}\n`);
  process.stdout.write(
    `Paseo daemon ${inspection.paseoDaemonReachable ? "reachable" : "unreachable"}\n`,
  );
  if (!inspection.paseoDaemonReachable) {
    for (const evidence of inspection.paseoDaemonEvidence) {
      process.stdout.write(`  ${evidence}\n`);
    }
  }
  for (const tool of inspection.tools) {
    process.stdout.write(
      `${tool.id}: ${tool.command ?? "not found"}${tool.version ? ` (${tool.version})` : ""}\n`,
    );
  }
  for (const link of inspection.links) process.stdout.write(`${link.state}: ${link.target}\n`);
  if (inspection.legacyInstallRecordPresent)
    process.stdout.write("legacy install record: present\n");
  if (inspection.interruptedTransactionPresent)
    process.stdout.write("interrupted install transaction: recovery required\n");
}

function printPlan(plan: InstallPlan): void {
  process.stdout.write(`Plan ${plan.planId}\n`);
  process.stdout.write(`Mode ${plan.mode}\n`);
  process.stdout.write(`Foundation ${plan.distributionVersion}\n`);
  process.stdout.write(
    `Control Workspace ${plan.includeControlWorkspace ? "included (experimental)" : "not included"}\n`,
  );
  if (plan.blockers.length === 0) {
    process.stdout.write("Status READY\n");
  } else {
    process.stdout.write("Status BLOCKED\n");
    for (const blocker of plan.blockers) process.stdout.write(`- ${blocker}\n`);
  }
}

function printRecord(record: InstallRecord): void {
  process.stdout.write(`Foundation ${record.distributionVersion}: ${record.status}\n`);
  process.stdout.write(`Release ${record.releasePath}\n`);
  process.stdout.write(
    record.controlHome
      ? `Control Workspace ${record.controlHome}\n`
      : "Control Workspace not included\n",
  );
}

function printDoctor(report: DoctorReport): void {
  process.stdout.write(`Foundation ${report.distributionVersion}\n`);
  for (const gate of report.gates) {
    process.stdout.write(`${gate.name}: ${gate.status}\n`);
    for (const evidence of gate.evidence) process.stdout.write(`  ${evidence}\n`);
  }
}

const program = new Command()
  .name("paseo-foundation")
  .description("Install and diagnose the Paseo Foundation distribution")
  .version(resolveFoundationCliVersion());

program
  .command("inspect")
  .description("Inspect the host without changing it")
  .option("--home <path>", "User home to inspect")
  .option("--product-root <path>", "Product checkout or packaged assets root")
  .option("--json", "Print JSON")
  .action((options: CommonOptions) => {
    const inspection = inspectMachine({
      home: resolvedHome(options.home),
      productRoot: options.productRoot,
    });
    if (options.json) writeJson(inspection);
    else printInspection(inspection);
  });

program
  .command("plan")
  .description("Create a stable install plan without changing the host")
  .addOption(
    new Option("--mode <mode>", "Install mode")
      .choices(["clean-empty", "coexist", "migration", "update"])
      .makeOptionMandatory(),
  )
  .option("--home <path>", "User home to inspect")
  .option("--product-root <path>", "Product checkout or packaged assets root")
  .option("--with-control-workspace", "Include the experimental mutable Control Workspace Home")
  .option(
    "--without-control-workspace",
    "Do not include or preserve the experimental mutable Control Workspace Home",
  )
  .option("--output <path>", "Write the plan as private JSON")
  .option("--json", "Print JSON")
  .action((options: PlanOptions) => {
    if (options.withControlWorkspace && options.withoutControlWorkspace) {
      throw new Error("choose only one of --with-control-workspace or --without-control-workspace");
    }
    let includeControlWorkspace: boolean | undefined;
    if (options.withControlWorkspace) includeControlWorkspace = true;
    if (options.withoutControlWorkspace) includeControlWorkspace = false;
    const plan = createInstallPlan({
      mode: options.mode,
      home: resolvedHome(options.home),
      productRoot: options.productRoot,
      includeControlWorkspace,
    });
    if (options.output) writeInstallPlan(options.output, plan);
    if (options.json) writeJson(plan);
    else printPlan(plan);
  });

for (const commandName of ["install", "upgrade"]) {
  program
    .command(commandName)
    .description(`${commandName === "install" ? "Apply" : "Apply an update from"} an exact plan`)
    .requiredOption("--plan <path>", "Exact plan JSON generated by the plan command")
    .option("--json", "Print JSON")
    .action((options: ApplyOptions) => {
      const applied = applyInstallPlan(readInstallPlan(options.plan));
      if (options.json) writeJson(applied);
      else printRecord(applied.record);
    });
}

program
  .command("doctor")
  .description("Report independent Foundation readiness gates")
  .option("--home <path>", "User home to inspect")
  .option("--product-root <path>", "Product checkout or packaged assets root")
  .option("--project <path>", "Optional target project")
  .option("--role-canary <path>", "Explicit role/tool canary receipt to validate")
  .option("--json", "Print JSON")
  .action((options: DoctorOptions) => {
    const report = doctorFoundation({
      home: resolvedHome(options.home),
      productRoot: options.productRoot,
      projectRoot: options.project,
      roleCanaryPath: options.roleCanary,
    });
    if (options.json) writeJson(report);
    else printDoctor(report);
  });

program
  .command("record-role-canary")
  .description("Validate and install a machine-readable role/tool canary receipt")
  .requiredOption("--receipt <path>", "Canary receipt produced by the qualification procedure")
  .option("--home <path>", "User home to inspect")
  .option("--product-root <path>", "Product checkout or packaged assets root")
  .option("--json", "Print JSON")
  .action((options: RecordRoleCanaryOptions) => {
    const home = resolvedHome(options.home);
    const report = doctorFoundation({
      home,
      productRoot: options.productRoot,
      roleCanaryPath: options.receipt,
    });
    const required = new Set([
      "DISTRIBUTION_VALID",
      "RUNTIME_EFFECTIVE",
      "ORCHESTRATION_READY",
      "ROLE_BOUNDARY_QUALIFIED",
    ]);
    const failures = report.gates.filter(
      (gate) => required.has(gate.name) && gate.status !== "PASS",
    );
    if (failures.length > 0) {
      throw new Error(
        `role canary receipt is not current: ${failures
          .map((gate) => `${gate.name}=${gate.status} (${gate.evidence.join("; ")})`)
          .join(", ")}`,
      );
    }
    const installed = installRoleBoundaryReceipt({ home, sourcePath: options.receipt });
    const result = {
      path: installed.path,
      qualifiedAt: installed.receipt.qualifiedAt,
      route: installed.receipt.route,
    };
    if (options.json) writeJson(result);
    else process.stdout.write(`Recorded current role/tool canary at ${installed.path}\n`);
  });

program
  .command("recover")
  .description("Recover an interrupted Foundation install transaction")
  .option("--home <path>", "User home to recover")
  .option("--json", "Print JSON")
  .action((options: CommonOptions) => {
    const recovered = recoverInterruptedInstall(resolvedHome(options.home));
    const result = { recovered };
    if (options.json) writeJson(result);
    else process.stdout.write(recovered ? "Recovery completed\n" : "No recovery required\n");
  });

program
  .command("rollback")
  .description("Return owned runtime links to the previous Foundation release")
  .option("--home <path>", "User home to inspect")
  .option("--json", "Print JSON")
  .action((options: CommonOptions) => {
    const record = rollbackInstall(resolvedHome(options.home));
    if (options.json) writeJson(record);
    else printRecord(record);
  });

program
  .command("uninstall")
  .description("Remove owned runtime links while preserving releases and Control Workspace data")
  .option("--home <path>", "User home to inspect")
  .option("--json", "Print JSON")
  .action((options: CommonOptions) => {
    const record = uninstallFoundation(resolvedHome(options.home));
    if (options.json) writeJson(record);
    else printRecord(record);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`paseo-foundation: ${message}\n`);
  process.exitCode = 1;
}
