/**
 * Validate the product files in assets/products/.
 *
 *   npm run products:check   # exit 1 on any problem
 *
 * Checks, in order:
 *   - index.json matches assets/schemas/products-index.schema.json, its IDs are
 *     unique, and its default is one of them.
 *   - Every product listed in the index has a file, and every product file is
 *     listed. `*.equivalents.json` files are derived data and are skipped here.
 *   - Each product file matches assets/schemas/product.schema.json and its `id`
 *     matches its file name.
 *   - Color slugs are unique within a product.
 *   - Every `reviewed` color carries a `sourceDate`. The schema already requires a
 *     date on every color; this check names the rule that matters most, because a
 *     reviewed value is never overwritten and must say when it was reviewed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, "..", "assets");
const SCHEMAS = join(ASSETS, "schemas");
export const PRODUCTS_DIR = join(ASSETS, "products");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function formatErrors(file: string, errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${file}: ${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

interface IndexShape {
  default: string;
  products: { id: string }[];
}

interface ProductShape {
  id: string;
  colors: { slug: string; source: string; sourceDate?: string }[];
}

/** Validate a products directory. Returns one message per problem; empty means valid. */
export function validateProducts(dir: string = PRODUCTS_DIR): string[] {
  const ajv = new Ajv2020({ allErrors: true });
  const checkIndex = ajv.compile(readJson(join(SCHEMAS, "products-index.schema.json")) as object);
  const checkProduct = ajv.compile(readJson(join(SCHEMAS, "product.schema.json")) as object);
  const problems: string[] = [];

  let index: unknown;
  try {
    index = readJson(join(dir, "index.json"));
  } catch (error) {
    return [`index.json: ${(error as Error).message}`];
  }
  if (!checkIndex(index)) return formatErrors("index.json", checkIndex.errors);

  const { default: defaultId, products } = index as IndexShape;
  const listed = new Set<string>();
  for (const { id } of products) {
    if (listed.has(id)) problems.push(`index.json: product "${id}" is listed twice`);
    listed.add(id);
  }
  if (!listed.has(defaultId)) {
    problems.push(`index.json: default "${defaultId}" is not a listed product`);
  }

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") && f !== "index.json" && !f.endsWith(".equivalents.json"),
  );
  const onDisk = new Set(files.map((f) => f.slice(0, -".json".length)));
  for (const id of listed) {
    if (!onDisk.has(id)) problems.push(`index.json: product "${id}" has no file ${id}.json`);
  }

  for (const file of files.sort()) {
    const fileId = file.slice(0, -".json".length);
    if (!listed.has(fileId)) problems.push(`${file}: not listed in index.json`);

    let product: unknown;
    try {
      product = readJson(join(dir, file));
    } catch (error) {
      problems.push(`${file}: ${(error as Error).message}`);
      continue;
    }

    // Name the reviewed-without-date rule explicitly, ahead of the schema's
    // generic "must have required property" message.
    const colors = (product as Partial<ProductShape>).colors;
    if (Array.isArray(colors)) {
      colors.forEach((c, i) => {
        if (c?.source === "reviewed" && !c.sourceDate) {
          problems.push(`${file}: /colors/${i} is reviewed but has no sourceDate`);
        }
      });
    }

    if (!checkProduct(product)) {
      problems.push(...formatErrors(file, checkProduct.errors));
      continue;
    }

    const p = product as ProductShape;
    if (p.id !== fileId) problems.push(`${file}: id "${p.id}" does not match the file name`);

    const seen = new Set<string>();
    for (const { slug } of p.colors) {
      if (seen.has(slug)) problems.push(`${file}: duplicate color slug "${slug}"`);
      seen.add(slug);
    }
  }

  return problems;
}

export function main(): number {
  const problems = validateProducts();
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`${p}\n`);
    process.stderr.write(`${problems.length} problem(s) in assets/products/.\n`);
    return 1;
  }
  process.stdout.write("Product files are valid.\n");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
