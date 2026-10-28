import "./env";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { closePool, query } from "../src/lib/db";
import { hashPin } from "../src/lib/auth";
async function main() {
  try {
    const { values } = parseArgs({
      options: {
        "college-id": { type: "string" },
        name: { type: "string" },
        role: { type: "string" },
        "reset-pin": { type: "boolean", default: false },
        "mess-id": { type: "string", default: "south-mess" },
      },
    });
    const id = values["college-id"]?.trim().toUpperCase();
    if (!id || !/^[A-Z0-9_-]{2,40}$/.test(id))
      throw new Error(
        "Provide --college-id (2–40 letters, digits, underscores or hyphens).",
      );
    const pin = process.env.USER_PIN;
    if (!pin || !/^\d{6,12}$/.test(pin))
      throw new Error(
        "Set USER_PIN to a new 6–12 digit PIN in the process environment. Do not put it in command arguments or commit it.",
      );
    const existing = await query("SELECT id FROM users WHERE college_id=$1", [
      id,
    ]);
    const hash = await hashPin(pin);
    if (existing.length) {
      if (!values["reset-pin"])
        throw new Error(
          "Account exists. Use --reset-pin explicitly to change its PIN.",
        );
      await query(
        "UPDATE users SET pin_hash=$1,session_version=session_version+1 WHERE college_id=$2",
        [hash, id],
      );
      console.log("PIN reset; existing sessions were revoked.");
    } else {
      if (values["reset-pin"]) throw new Error("Account not found.");
      if (
        !values.name?.trim() ||
        values.name.trim().length > 100 ||
        !["student", "manager"].includes(values.role ?? "")
      )
        throw new Error(
          "New accounts require --name and --role student|manager.",
        );
      await query(
        "INSERT INTO users(id,college_id,name,role,mess_id,pin_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          id,
          values.name.trim(),
          values.role,
          values["mess-id"] ?? "south-mess",
          hash,
        ],
      );
      console.log(`Created ${values.role} account ${id}.`);
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message.replace(
            /postgres(?:ql)?:\/\/\S+/g,
            "[redacted database URL]",
          )
        : "Account command failed",
    );
    process.exitCode = 1;
  } finally {
    delete process.env.USER_PIN;
    await closePool();
  }
}
void main();
