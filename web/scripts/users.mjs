#!/usr/bin/env node
/**
 * Admin-only user management for Supabase Auth (BRD 2.10: no
 * self-registration — accounts are created, reset and disabled by an
 * administrator, never from the app).
 *
 *   npm run users -- create broker@ukcib.co.uk "Sam Broker"
 *   npm run users -- reset  broker@ukcib.co.uk
 *   npm run users -- disable broker@ukcib.co.uk
 *   npm run users -- enable  broker@ukcib.co.uk
 *   npm run users -- list
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL (or
 * SUPABASE_URL) in the environment or in web/.env.local. The service-role
 * key bypasses RLS: keep it on the operator's machine only.
 *
 * Temporary passwords are generated here and printed ONCE; convey them
 * securely and ask the user to change theirs (an admin can `reset` again).
 */
import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

function generatePassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*-_=+";
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

loadDotEnv();

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !serviceKey) {
  fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment or web/.env.local).");
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

async function findByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) fail(error.message);
  const user = data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  if (!user) fail(`No user with email ${email}.`);
  return user;
}

const [command, emailArg, ...rest] = process.argv.slice(2);
const email = (emailArg || "").trim().toLowerCase();

switch (command) {
  case "create": {
    if (!email) fail("Usage: users create <email> [name]");
    const name = rest.join(" ").trim();
    const password = process.env.SUPABASE_NEW_USER_PASSWORD || generatePassword();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no email round-trip: the admin hands over the credentials
      user_metadata: name ? { name } : {},
    });
    if (error) fail(error.message);
    console.log(`✔ Created ${data.user.email} (id ${data.user.id})`);
    console.log(`  Temporary password (shown once): ${password}`);
    break;
  }
  case "reset": {
    if (!email) fail("Usage: users reset <email>");
    const user = await findByEmail(email);
    const password = process.env.SUPABASE_NEW_USER_PASSWORD || generatePassword();
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) fail(error.message);
    // Invalidate every existing session so the old credentials stop working now.
    await supabase.auth.admin.signOut(user.id, "global").catch(() => {});
    console.log(`✔ Password reset for ${email}; all sessions signed out.`);
    console.log(`  Temporary password (shown once): ${password}`);
    break;
  }
  case "disable": {
    if (!email) fail("Usage: users disable <email>");
    const user = await findByEmail(email);
    const { error } = await supabase.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
    if (error) fail(error.message);
    await supabase.auth.admin.signOut(user.id, "global").catch(() => {});
    console.log(`✔ Disabled ${email} (banned for 100 years; use "enable" to restore).`);
    break;
  }
  case "enable": {
    if (!email) fail("Usage: users enable <email>");
    const user = await findByEmail(email);
    const { error } = await supabase.auth.admin.updateUserById(user.id, { ban_duration: "none" });
    if (error) fail(error.message);
    console.log(`✔ Enabled ${email}.`);
    break;
  }
  case "role": {
    // app_metadata is writable with the service role only, so the admin
    // role in the token cannot be self-assigned from the browser.
    const role = (process.argv[4] || "").toLowerCase();
    if (!email || !["admin", "broker"].includes(role)) fail("Usage: users role <email> <admin|broker>");
    const user = await findByEmail(email);
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: { ...(user.app_metadata || {}), role },
    });
    if (error) fail(error.message);
    await supabase.auth.admin.signOut(user.id, "global").catch(() => {});
    console.log(`✔ ${email} is now ${role} (signed out everywhere; the new role applies at next sign-in).`);
    break;
  }
  case "list": {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) fail(error.message);
    for (const u of data.users) {
      const name = u.user_metadata?.name || "";
      const role = u.app_metadata?.role === "admin" ? " [admin]" : "";
      const banned = u.banned_until && new Date(u.banned_until) > new Date() ? " [disabled]" : "";
      console.log(`${u.email}\t${name}\tlast sign-in: ${u.last_sign_in_at || "never"}${role}${banned}`);
    }
    if (!data.users.length) console.log("(no users)");
    break;
  }
  default:
    console.log("Usage: npm run users -- <create <email> [name] | reset <email> | disable <email> | enable <email> | role <email> <admin|broker> | list>");
    process.exit(command ? 1 : 0);
}
