const fs = require("fs");
const path = require("path");

const buildDirectory = path.resolve(__dirname, "..", "build");
const forbidden = [
  "/api/internal/",
  "/api/purchases",
  "/api/suppliers",
  "/api/payments",
  "/api/settings",
  "/api/items",
  'path:"/purchases"',
  'path:"/suppliers"',
  'path:"/payments"',
  'path:"/settings"',
];

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}

if (!fs.existsSync(buildDirectory)) {
  throw new Error("Public build directory does not exist. Run npm run build:public first.");
}

const bundles = filesBelow(buildDirectory).filter((file) => /\.(js|html)$/.test(file));
if (bundles.length === 0) {
  throw new Error("Public build contains no JavaScript or HTML assets.");
}

const findings = [];
for (const file of bundles) {
  const content = fs.readFileSync(file, "utf8");
  for (const marker of forbidden) {
    if (content.includes(marker)) findings.push(`${path.relative(buildDirectory, file)}: ${marker}`);
  }
}
if (findings.length) {
  throw new Error(`Public build contains internal ERP markers:\n${findings.join("\n")}`);
}
console.log(`Public build isolation passed across ${bundles.length} assets.`);
