import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures";
import { deleteUserViaCli } from "../fixtures/admin";
import { loginViaToken, openProject } from "../helpers/login";
import { adminPanel, header } from "../helpers/selectors";

/**
 * AdminPanel coverage:
 *  - admin can list users
 *  - admin can create a sub-user (non-admin) and is shown the new token
 *  - that sub-user logs in successfully but does NOT see the Admin button,
 *    proving the UI gates admin actions.
 *
 * The plan calls this "create + revoke + assert denied". The actual UI uses
 * a Delete button rather than a separate "revoke" — we delete after the
 * sub-user has been verified as non-privileged.
 */

test("admin lists users, creates a sub-user, and the sub-user has no admin powers", async ({
  page,
  admin,
  tempProject,
}) => {
  // loginViaToken triggers the initial profile fetch (which sets isAdmin in
  // the token store). The plain LoginScreen path does not, so the Admin
  // header button would stay hidden after a fresh form login.
  await loginViaToken(page, admin.token);
  await openProject(page, tempProject.path);

  // Open Admin panel from header.
  await page.getByRole(header.adminButton.role, { name: header.adminButton.name }).click();
  await expect(page.locator(adminPanel.panel)).toBeVisible();

  // Existing admin must show up in the user list.
  const adminRow = page.locator(adminPanel.userRow).filter({ has: page.locator(adminPanel.userId, { hasText: admin.id }) });
  await expect(adminRow).toBeVisible();

  // Create a non-admin sub-user.
  const subUserId = `sub_${randomBytes(3).toString("hex")}`;
  await page.locator(adminPanel.userIdInput).fill(subUserId);
  await page.locator(adminPanel.nameInput).fill(`Sub ${subUserId}`);
  // adminCheckbox stays unchecked → non-admin
  await page.getByRole(adminPanel.createButton.role, { name: adminPanel.createButton.name }).click();

  // The new token banner appears.
  await expect(page.locator(adminPanel.tokenBanner)).toBeVisible();
  const subToken = (await page.locator(adminPanel.tokenValue).innerText()).trim();
  expect(subToken).toMatch(/^bns_[A-Za-z0-9]+$/);

  // The new user shows up in the list.
  const subRow = page.locator(adminPanel.userRow).filter({ has: page.locator(adminPanel.userId, { hasText: subUserId }) });
  await expect(subRow).toBeVisible();

  // ── Now log out the admin and log in as the sub-user via a fresh context. ──
  // Doing it on the same page is awkward because TokenDialog's Clear reloads
  // the page; using a new browser context keeps the test deterministic.
  const subContext = await page.context().browser()!.newContext({
    extraHTTPHeaders: { "X-Bonsai-E2E": "1" },
  });
  const subPage = await subContext.newPage();
  try {
    await loginViaToken(subPage, subToken);
    await openProject(subPage, tempProject.path);

    // Sub-user is NOT admin → Admin button is hidden in the header.
    await expect(subPage.getByRole(header.adminButton.role, { name: header.adminButton.name })).toHaveCount(0);
  } finally {
    await subContext.close();
  }

  // Back on the admin page — delete the sub-user as cleanup + assert UI removes it.
  await subRow.getByRole(adminPanel.deleteButton.role, { name: adminPanel.deleteButton.name }).click();
  await expect(subRow).toHaveCount(0);
});

test("a non-admin user cannot reach admin RPCs even with a valid token", async ({
  page,
  admin,
  tempProject,
}) => {
  // Provision a non-admin user via the admin panel. We talk to the admin
  // panel rather than spinning up another CLI invocation: this exercises
  // the same code path users follow.
  await loginViaToken(page, admin.token);
  await openProject(page, tempProject.path);

  await page.getByRole(header.adminButton.role, { name: header.adminButton.name }).click();
  const subUserId = `nonadm_${randomBytes(3).toString("hex")}`;
  await page.locator(adminPanel.userIdInput).fill(subUserId);
  await page.locator(adminPanel.nameInput).fill(`Non-admin ${subUserId}`);
  await page.getByRole(adminPanel.createButton.role, { name: adminPanel.createButton.name }).click();
  const subToken = (await page.locator(adminPanel.tokenValue).innerText()).trim();

  // Now make a raw WebSocket RPC call to admin/listUsers using the
  // sub-user's token; the backend should reject it with the FORBIDDEN
  // error code defined in app/rpc/methods/admin.py (-32000).
  const result = await page.evaluate(
    async ({ token, projectPath }: { token: string; projectPath: string }) => {
      const wsUrl =
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}` +
        `/ws?project=${encodeURIComponent(projectPath)}&token=${encodeURIComponent(token)}`;
      return await new Promise<{ error?: { code: number; message: string }; result?: unknown }>(
        (resolve, reject) => {
          const sock = new WebSocket(wsUrl);
          const timer = setTimeout(() => {
            sock.close();
            reject(new Error("WS RPC timeout"));
          }, 10_000);
          sock.onopen = () => {
            sock.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "admin/listUsers",
                params: {},
              }),
            );
          };
          sock.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg && msg.id === 1) {
                clearTimeout(timer);
                sock.close();
                resolve(msg);
              }
            } catch {
              // ignore non-JSON frames
            }
          };
          sock.onerror = () => {
            clearTimeout(timer);
            sock.close();
            reject(new Error("WS error"));
          };
        },
      );
    },
    { token: subToken, projectPath: tempProject.path },
  );

  expect(result.error).toBeDefined();
  expect(result.error!.message).toMatch(/Admin access required/i);

  // Cleanup: delete the sub-user created for this test.
  deleteUserViaCli(subUserId);
});
