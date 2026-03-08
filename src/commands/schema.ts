import { publicRequest } from "../api.js";
import pc from "picocolors";
import { heading, blank, table, createSpinner, jsonOut, fail, fmt } from "../ui.js";

export async function schema(
  command?: string,
  options?: { json?: boolean; fields?: string },
): Promise<void> {
  const json = options?.json;
  const fields = options?.fields;

  const path = command ? `/api/schema?command=${encodeURIComponent(command)}` : "/api/schema";

  const s = createSpinner(!json);
  s.start("Loading schema");

  const res = await publicRequest(path);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json, fields });
  }

  s.stop("Schema loaded");

  if (json) {
    jsonOut(data, fields);
    return;
  }

  if (command) {
    renderCommand(command, data);
  } else {
    renderCommandList(data.commands);
  }
}

function renderCommandList(commands: Record<string, { description: string; usage: string }>): void {
  heading("Commands");

  const rows = Object.entries(commands).map(([name, cmd]) => [
    pc.bold(pc.cyan(name)),
    cmd.description,
  ]);

  table(["Command", "Description"], rows, [20, 50]);
  blank();
  console.log(`  ${pc.dim("Run")} ${pc.cyan("domani schema <command>")} ${pc.dim("for full details")}`);
  blank();
}

interface ParamInfo {
  type: string;
  required?: boolean;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  items?: string;
  default?: unknown;
  in?: string;
}

interface ApiInfo {
  method: string;
  path: string;
  parameters?: Record<string, ParamInfo>;
}

function renderCommand(
  name: string,
  data: {
    description: string;
    usage: string;
    arguments?: Record<string, { type: string; required: boolean; variadic?: boolean; description?: string }>;
    options?: Record<string, { type: string; description: string; required?: boolean; choices?: string[] }>;
    api?: ApiInfo | Record<string, ApiInfo>;
    errors?: string[];
  },
): void {
  heading(`domani ${name}`);
  console.log(`  ${data.description}`);
  blank();
  console.log(`  ${fmt.label("Usage:")} ${pc.cyan(data.usage)}`);

  // Arguments
  if (data.arguments && Object.keys(data.arguments).length > 0) {
    blank();
    console.log(`  ${pc.bold("Arguments")}`);
    for (const [argName, arg] of Object.entries(data.arguments)) {
      const req = arg.required ? pc.red("*") : "";
      const type = pc.dim(`(${arg.type}${arg.variadic ? ", variadic" : ""})`);
      console.log(`    ${pc.cyan(argName)}${req} ${type}`);
      if (arg.description) console.log(`      ${pc.dim(arg.description)}`);
    }
  }

  // Options
  if (data.options && Object.keys(data.options).length > 0) {
    blank();
    console.log(`  ${pc.bold("Options")}`);
    for (const [optName, opt] of Object.entries(data.options)) {
      const req = opt.required ? pc.red("*") : "";
      const type = pc.dim(`(${opt.type})`);
      const choices = opt.choices ? pc.dim(` [${opt.choices.join(", ")}]`) : "";
      console.log(`    ${pc.cyan(`--${optName}`)}${req} ${type}${choices}`);
      console.log(`      ${pc.dim(opt.description)}`);
    }
  }

  // API parameters
  if (data.api) {
    blank();
    console.log(`  ${pc.bold("API")}`);
    if (isApiSchema(data.api)) {
      renderApiSchema(data.api);
    } else {
      for (const [subName, sub] of Object.entries(data.api)) {
        console.log(`    ${pc.bold(pc.yellow(subName))}`);
        renderApiSchema(sub, 6);
      }
    }
  }

  // Errors
  if (data.errors && data.errors.length > 0) {
    blank();
    console.log(`  ${pc.bold("Errors")}`);
    console.log(`    ${data.errors.map((e) => pc.dim(e)).join(pc.dim(", "))}`);
  }

  blank();
}

function isApiSchema(api: unknown): api is ApiInfo {
  return typeof api === "object" && api !== null && "method" in api && "path" in api;
}

function renderApiSchema(api: ApiInfo, indent = 4): void {
  const pad = " ".repeat(indent);
  console.log(`${pad}${pc.green(api.method)} ${pc.white(api.path)}`);

  if (api.parameters && Object.keys(api.parameters).length > 0) {
    for (const [paramName, param] of Object.entries(api.parameters)) {
      const req = param.required ? pc.red("*") : "";
      const parts = [param.type];
      if (param.enum) parts.push(`enum: ${param.enum.join(", ")}`);
      if (param.minimum !== undefined) parts.push(`min: ${param.minimum}`);
      if (param.maximum !== undefined) parts.push(`max: ${param.maximum}`);
      if (param.maxItems !== undefined) parts.push(`maxItems: ${param.maxItems}`);
      if (param.items) parts.push(`items: ${param.items}`);
      if (param.in === "path") parts.push("in: path");
      const type = pc.dim(`(${parts.join(", ")})`);
      console.log(`${pad}  ${pc.cyan(paramName)}${req} ${type}`);
      if (param.description) console.log(`${pad}    ${pc.dim(param.description)}`);
    }
  }
}
