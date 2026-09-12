// Uso: node report_issue.mjs <owner> <repo> <token> <titulo> <archivo-de-log>
import fs from "node:fs";

const [, , owner, repo, token, title, logPath] = process.argv;
const body = fs.readFileSync(logPath, "utf8").slice(-60000);

const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ title, body: "```\n" + body + "\n```" }),
});
console.log("Issue creado:", res.status);
