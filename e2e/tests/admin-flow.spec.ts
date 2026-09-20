import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { authenticator } from "otplib";
import { NEW_PASSWORD, SUPER_EMAIL, SUPER_PASSWORD } from "../constants";

const STAFF_EMAIL = `e2e-staff-${Date.now()}@test.local`;
const STAFF_TEMP = "Temp!Passw0rd#77";
const STAFF_FINAL = "Staff!Final#Pass9";

const AADHAAR = "234567890124"; // valid Verhoeff checksum
const CUSTOMER = { first: "Vasundhara", last: "Kumari", phone: "9876512345" };
// Minimal PNG header: the server decides file type from the bytes.
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 7)]);
const png = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });

async function signIn(page: Page, email: string, password: string, totpSecret?: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (totpSecret) {
    await page.getByLabel("Authenticator code").fill(authenticator.generate(totpSecret));
    await page.getByRole("button", { name: "Verify and sign in" }).click();
  }
}

async function changePassword(page: Page, current: string, next: string) {
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  await page.getByRole("button", { name: "Change password" }).click();
}

test.describe.serial("admin and staff journey", () => {
  let totpSecret = "";

  test("Super Admin: forced password change, mandatory 2FA, then the dashboard", async ({ page }) => {
    await signIn(page, SUPER_EMAIL, SUPER_PASSWORD);
    await changePassword(page, SUPER_PASSWORD, NEW_PASSWORD);

    await expect(page.getByRole("heading", { name: "Set up two-factor authentication" })).toBeVisible();
    totpSecret = (await page.getByTestId("totp-secret").textContent()) ?? "";
    expect(totpSecret.length).toBeGreaterThan(10);
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Turn on 2FA" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid code");

    await page.getByLabel("6-digit code").fill(authenticator.generate(totpSecret));
    await page.getByRole("button", { name: "Turn on 2FA" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "User Management" })).toBeVisible();
  });

  test("Super Admin creates an invited user and a user with a temporary password", async ({ page }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "User Management" }).click();
    await expect(page.getByRole("row", { name: /Super Admin/ })).toContainText("Protected");

    await page.getByRole("button", { name: "Add User" }).click();
    await page.getByLabel("First Name").fill("Invited");
    await page.getByLabel("Email").fill(`e2e-invited-${Date.now()}@test.local`);
    await page.getByLabel("Mobile").fill("98765 43210");
    await expect(page.getByLabel("Role").locator("option", { hasText: "Super Admin" })).toHaveCount(0);
    await page.getByLabel("Role").selectOption({ label: "Staff" });
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText("User created")).toBeVisible();
    await expect(page.getByRole("row", { name: /Invited/ })).toContainText("Invited");

    await page.getByRole("button", { name: "Add User" }).click();
    await page.getByLabel("First Name").fill("Field");
    await page.getByLabel("Email").fill(STAFF_EMAIL);
    await page.getByLabel("Mobile").fill("9876500001");
    await page.getByLabel("Role").selectOption({ label: "Staff" });
    await page.getByLabel("Set a temporary password now").check();
    await page.getByLabel(/^Temporary password/).fill("weak");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText("At least 12 characters")).toBeVisible();
    await page.getByLabel(/^Temporary password/).fill(STAFF_TEMP);
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("row", { name: new RegExp(STAFF_EMAIL) })).toContainText("Active");
  });

  test("Roles tab: Super Admin role is read-only, and a custom role can be created", async ({ page }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "User Management" }).click();
    await page.getByRole("tab", { name: "Roles & Permissions" }).click();

    await page.getByRole("button", { name: "View permissions for Super Admin" }).click();
    await expect(page.getByText("protected and cannot be changed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save role" })).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).first().click();

    await page.getByRole("button", { name: "New Role" }).click();
    await page.getByLabel("Role Name").fill("Branch Manager");
    await page.getByRole("checkbox", { name: "customer:view" }).check();
    await page.getByRole("button", { name: "Create role" }).click();
    await expect(page.getByRole("heading", { name: "Branch Manager" })).toBeVisible();
  });

  test("Staff: forced password change, restricted navigation, blocked direct URL", async ({ page }) => {
    await signIn(page, STAFF_EMAIL, STAFF_TEMP);
    await changePassword(page, STAFF_TEMP, STAFF_FINAL);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await expect(page.getByRole("link", { name: "User Management" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Audit Log" })).toHaveCount(0);
    await page.goto("/user-management");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  });

  test("Suspending a user signs them out and blocks login", async ({ page, browser }) => {
    const staffPage = await (await browser.newContext()).newPage();
    await signIn(staffPage, STAFF_EMAIL, STAFF_FINAL);
    await expect(staffPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "User Management" }).click();
    await page.getByRole("button", { name: /^Suspend Field/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Field");
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(STAFF_EMAIL) })).toContainText("Suspended");

    // The staff member's open session stops working immediately.
    await staffPage.goto("/");
    await expect(staffPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await signIn(staffPage, STAFF_EMAIL, STAFF_FINAL);
    await expect(staffPage.getByRole("alert")).toContainText("Invalid email or password");
  });

  test("Register a customer through the 6-step wizard, with uploads and consent", async ({ page }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await page.getByRole("button", { name: "Add Customer" }).click();
    await expect(page.getByText("Step 1 of 6")).toBeVisible();

    // 1. Basic details (incomplete data is rejected with field errors, then a draft can still be saved)
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await page.getByLabel("First Name").fill(CUSTOMER.first);
    await page.getByLabel("Last Name").fill(CUSTOMER.last);
    await page.getByLabel("Gender").selectOption("FEMALE");
    await page.getByLabel("Date of Birth").fill("1990-05-15");
    await page.getByLabel("Mobile Number").fill(CUSTOMER.phone);
    await page.getByLabel("Marital Status").selectOption("MARRIED");
    await page.getByLabel("Upload Customer photo").setInputFiles(png("photo.png"));
    await expect(page.getByRole("button", { name: "Remove Customer photo" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // 2. Address
    await expect(page.getByText("Step 2 of 6")).toBeVisible();
    await page.getByLabel("Current Address").fill("12 Gandhi Road, Kanchipuram");
    await page.getByRole("button", { name: "Same as current address" }).click();
    await page.getByLabel("State").fill("Tamil Nadu");
    await page.getByLabel("District / City").fill("Kanchipuram");
    await page.getByLabel("Pincode").fill("631501");
    await page.getByRole("button", { name: "Next" }).click();

    // 3. KYC numbers are validated (bad Aadhaar is rejected) and documents upload immediately
    await expect(page.getByText("Step 3 of 6")).toBeVisible();
    await page.getByLabel("Aadhaar Number").fill("123456789012");
    await page.getByLabel("PAN Number").fill("ABCDE1234F");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Aadhaar number is not valid")).toBeVisible();
    await page.getByLabel("Aadhaar Number").fill(AADHAAR);
    await page.getByLabel("Upload Aadhaar Front").setInputFiles(png("front.png"));
    await page.getByLabel("Upload PAN Card").setInputFiles(png("pan.png"));
    await expect(page.getByRole("button", { name: "Remove Aadhaar Front" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove PAN Card" })).toBeVisible();
    await page
      .getByLabel("Upload Aadhaar Front")
      .setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>") })
      .catch(() => undefined);
    await page.getByRole("button", { name: "Next" }).click();

    // 4. Employment and bank
    await expect(page.getByText("Step 4 of 6")).toBeVisible();
    await page.getByLabel(/Monthly Salary/).fill("50000");
    await page.getByLabel("Bank Name").fill("State Bank of India");
    await page.getByLabel("Account Number").fill("123456789012");
    await page.getByLabel("IFSC Code").fill("sbin0001234");
    await page.getByRole("button", { name: "Next" }).click();

    // 5. Family, nominee, references
    await expect(page.getByText("Step 5 of 6")).toBeVisible();
    await page.getByLabel("Father's Name").fill("Raman");
    await page.getByLabel("Mother's Name").fill("Lakshmi");
    await page.getByLabel("Nominee Name").fill("Kumar");
    await page.getByLabel("Relation").fill("Spouse");
    await page.getByLabel("Reference 1 Name").fill("Suresh");
    await page.getByLabel("Reference 1 Mobile").fill("9876500002");
    await page.getByRole("button", { name: "Next" }).click();

    // 6. Evaluation: risk is computed live, consent is mandatory
    await expect(page.getByText("Step 6 of 6")).toBeVisible();
    await page.getByLabel(/CIBIL Score/).fill("780");
    await page.getByLabel(/Monthly EMI/).fill("5000");
    await expect(page.getByText("Low risk")).toBeVisible();
    await page.getByRole("button", { name: "Create Customer" }).click();
    await expect(page.getByText("Consent is required")).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create Customer" }).click();

    await expect(page.getByRole("heading", { name: `${CUSTOMER.first} ${CUSTOMER.last}` })).toBeVisible();
    await expect(page.getByText("KYC complete")).toBeVisible(); // photo, Aadhaar and PAN all supplied; review still pending
    await expect(page.getByText("Low risk").first()).toBeVisible();
  });

  test("KYC review: sensitive numbers are masked, reveal is explicit, verification updates the status", async ({
    page,
  }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await page.getByPlaceholder(/Search name/).fill(CUSTOMER.first);
    await page.getByRole("row", { name: new RegExp(CUSTOMER.first) }).click();

    await page.getByRole("tab", { name: "KYC & Documents" }).click();
    await expect(page.getByText(`XXXX-XXXX-${AADHAAR.slice(-4)}`)).toBeVisible();
    await expect(page.getByText(AADHAAR)).toHaveCount(0);
    await page.getByRole("button", { name: /Reveal aadhaar/ }).click();
    await expect(page.getByText(AADHAAR)).toBeVisible();

    await page.getByRole("button", { name: "Verify Aadhaar" }).click();
    await expect(page.getByText("Document verified")).toBeVisible();
    await page.getByRole("button", { name: "Reject PAN" }).click();
    await page.getByLabel(/Reason/).fill("Image is blurred");
    await page.getByRole("button", { name: "Reject document" }).click();
    await expect(page.getByText("Rejected: Image is blurred")).toBeVisible();

    await page
      .getByRole("button", { name: "View Aadhaar front" })
      .or(page.getByRole("button", { name: /front/i }))
      .first()
      .click();
    await expect(page.getByRole("dialog").locator("img")).toBeVisible();
  });

  test("Duplicate warning appears as soon as a matching mobile number is saved", async ({ page }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await page.getByRole("button", { name: "Add Customer" }).click();
    await page.getByLabel("First Name").fill("Someone");
    await page.getByLabel("Gender").selectOption("MALE");
    await page.getByLabel("Date of Birth").fill("1985-01-01");
    await page.getByLabel("Mobile Number").fill(CUSTOMER.phone);
    await page.getByLabel("Marital Status").selectOption("SINGLE");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "may already exist" })).toContainText(
      `${CUSTOMER.first} ${CUSTOMER.last}`,
    );
    await expect(page.getByRole("alert").filter({ hasText: "may already exist" })).toContainText("Same mobile number");

    // The half-finished record shows up under "Partially Saved"
    await page.getByRole("link", { name: /Back to Customers/ }).click();
    await page.getByRole("tab", { name: /Partially Saved/ }).click();
    await expect(page.getByRole("row", { name: /Someone/ })).toBeVisible();
  });

  test("Notes and follow-ups, tags and blacklisting on a customer profile", async ({ page }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await page.getByPlaceholder(/Search name/).fill(CUSTOMER.first);
    await page.getByRole("row", { name: new RegExp(CUSTOMER.first) }).click();

    await page.getByRole("tab", { name: "Notes & Follow-ups" }).click();
    await page.getByLabel("Type").selectOption("CALL");
    await page.getByLabel("Outcome").fill("Promised to pay on the 25th");
    await page.getByLabel("Follow up on").fill(new Date().toISOString().slice(0, 10));
    await page.getByLabel(/^Note/).fill("Called about the pending installment");
    await page.getByRole("button", { name: "Save and schedule follow-up" }).click();
    await expect(page.getByText("Follow-up scheduled")).toBeVisible();
    await expect(page.getByText("Outcome: Promised to pay on the 25th")).toBeVisible();

    // It shows up on the dashboard until it is marked done
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("link", { name: CUSTOMER.first + " " + CUSTOMER.last })).toBeVisible();
    await page.getByRole("link", { name: CUSTOMER.first + " " + CUSTOMER.last }).click();
    await page.getByRole("tab", { name: "Notes & Follow-ups" }).click();
    await page.getByRole("button", { name: "Mark follow-up done" }).click();
    await expect(page.getByText(/^Done /)).toBeVisible();

    // Tags and blacklist (a reason is required)
    await page.getByRole("button", { name: "Add tags" }).click();
    await page.getByRole("textbox", { name: "Tags" }).fill("VIP, referred");
    await page.getByRole("button", { name: "Save tags" }).click();
    await expect(page.getByText("referred", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Watchlist \/ blacklist/ }).click();
    await page.getByLabel("Status").selectOption("BLACKLIST");
    await page.getByLabel(/^Reason/).fill("ab");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByLabel(/^Reason/)).toBeVisible(); // still open: reason too short
    await page.getByLabel(/^Reason/).fill("Loan defaulted and cheque bounced");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Loan defaulted and cheque bounced" })).toContainText(
      "Blacklisted",
    );
  });

  test("Bulk upload: template, validation, rows to fix, corrected re-upload and import", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await page.getByRole("button", { name: "Bulk upload" }).click();
    await expect(page.getByRole("heading", { name: "Bulk upload customers" })).toBeVisible();

    // 1. The template downloads as an Excel file with marked mandatory columns
    const [tpl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Excel template" }).click(),
    ]);
    expect(tpl.suggestedFilename()).toBe("jana-customer-import-template.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await tpl.path())!);
    const ws = wb.getWorksheet("Customers")!;
    const headers = ws.getRow(1).values as string[];
    const col = (h: string) => headers.findIndex((x) => typeof x === "string" && x.replace(/\s*\*$/, "") === h);
    expect(headers.filter((x) => typeof x === "string" && x.endsWith("*")).length).toBeGreaterThan(20);

    const row = (n: number, v: Record<string, string | number>) => {
      for (const [h, val] of Object.entries(v)) ws.getCell(n, col(h)).value = val;
    };
    const base = {
      "Last name": "Bulk",
      Gender: "Male",
      "Date of birth": "20/07/1988",
      "Marital status": "Single",
      "Current address": "5 Nehru Street",
      "Permanent address": "5 Nehru Street",
      State: "Tamil Nadu",
      District: "Vellore",
      Pincode: "632001",
      "Residence type": "Rented",
      Occupation: "Business",
      "Monthly income (₹)": 42000,
      "Bank name": "Indian Bank",
      IFSC: "IDIB000K123",
      "Father's name": "Mani",
      "Mother's name": "Devi",
      "Nominee name": "Priya",
      "Nominee relation": "Sister",
      "Reference 1 name": "Ravi",
      "CIBIL score": 705,
    };
    // row 2: good. row 3: several mistakes. row 4: the same mobile as the customer created earlier.
    row(2, {
      ...base,
      "First name": "Bulkgood",
      Mobile: "9812300001",
      "Aadhaar number": "345678901238",
      PAN: "BULKA1111A",
      "Bank account number": "40012345671",
      "Reference 1 mobile": "9812300099",
    });
    row(3, {
      ...base,
      "First name": "Bulkfixme",
      Mobile: "12345",
      "Aadhaar number": "123456789012",
      PAN: "BAD",
      "Bank account number": "40012345672",
      "Reference 1 mobile": "9812300098",
      "CIBIL score": 950,
    });
    row(4, {
      ...base,
      "First name": "Bulkdup",
      Mobile: CUSTOMER.phone,
      "Aadhaar number": "456789012341",
      PAN: "BULKC3333C",
      "Bank account number": "40012345673",
      "Reference 1 mobile": "9812300097",
    });
    const filled = test.info().outputPath("filled.xlsx");
    await wb.xlsx.writeFile(filled);

    // 2. Upload: every row is checked, nothing is saved
    await page.getByLabel("Filled Excel file").setInputFiles(filled);
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText("1 ready")).toBeVisible();
    await expect(page.getByText("1 need fixing")).toBeVisible();
    await expect(page.getByText("1 possible duplicates")).toBeVisible();
    await expect(page.getByRole("row", { name: /Bulkfixme/ })).toContainText("Mobile:");
    await expect(page.getByRole("row", { name: /Bulkfixme/ })).toContainText("Aadhaar number:");
    await expect(page.getByRole("row", { name: /Bulkfixme/ })).toContainText("CIBIL score:");
    await page.getByRole("tab", { name: /Possible duplicates/ }).click();
    await expect(page.getByRole("row", { name: /Bulkdup/ })).toContainText("Same mobile number");
    await page.getByRole("tab", { name: /Ready to import/ }).click();
    await expect(page.getByRole("row", { name: /Bulkgood/ })).toBeVisible();

    // 3. Import the good row; the failing rows are left out
    await page.getByRole("button", { name: "Import 1 customer as drafts" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Import 1" }).click();
    await expect(page.getByText("1 customer imported as drafts.")).toBeVisible();

    // 4. Download the rows to fix, correct them, and upload the corrected file
    const [fix] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download 1 row to fix/ }).click(),
    ]);
    const fwb = new ExcelJS.Workbook();
    await fwb.xlsx.readFile((await fix.path())!);
    const fws = fwb.getWorksheet("Customers")!;
    const fh = fws.getRow(1).values as string[];
    const fcol = (h: string) => fh.findIndex((x) => typeof x === "string" && x.replace(/\s*\*$/, "") === h);
    expect(fh).toContain("Errors");
    expect(fws.getRow(2).getCell(fcol("First name")).value).toBe("Bulkfixme");
    expect(String(fws.getRow(2).getCell(fcol("Errors")).value)).toContain("Mobile");
    expect(fws.getRow(3).getCell(1).value).toBeNull(); // only the one failed row
    fws.getCell(2, fcol("Mobile")).value = "9812300002";
    fws.getCell(2, fcol("Aadhaar number")).value = "567890123458";
    fws.getCell(2, fcol("PAN")).value = "BULKB2222B";
    fws.getCell(2, fcol("CIBIL score")).value = 700;
    const fixed = test.info().outputPath("fixed.xlsx");
    await fwb.xlsx.writeFile(fixed);

    await page.getByLabel("Filled Excel file").setInputFiles(fixed);
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByText("1 ready")).toBeVisible();
    await expect(page.getByText(/need fixing/)).toHaveCount(0);
    await page.getByRole("button", { name: "Import 1 customer as drafts" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Import 1" }).click();
    await expect(page.getByText("1 customer imported as drafts.")).toBeVisible();

    // 5. Both imported customers are complete drafts waiting for consent, and uploads are listed
    await expect(page.getByText("Recent uploads")).toBeVisible();
    await page.getByRole("button", { name: "Go to Customers" }).click();
    await page.getByRole("tab", { name: /Partially Saved/ }).click();
    await page.getByPlaceholder(/Search name/).fill("Bulk");
    await expect(page.getByRole("row", { name: /Bulkgood/ })).toContainText("Awaiting consent");
    await expect(page.getByRole("row", { name: /Bulkfixme/ })).toContainText("Awaiting consent");
  });

  test("Export downloads a CSV of the current filter", async ({ page }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export" }).click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/^customers-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = (await readFile(await dl.path())).toString();
    expect(text).toContain("Code,Name,Status");
    expect(text).toContain(`${CUSTOMER.first} ${CUSTOMER.last}`);
    expect(text).not.toContain(AADHAAR);
  });

  test("Chit fund: create a group, enrol members, run the auction, collect, and pay out the prize", async ({
    page,
  }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await page.getByRole("link", { name: "Chit Funds" }).click();
    await page.getByRole("link", { name: "New Chit Group" }).click();

    // A configuration that does not add up is explained, not silently accepted
    await page.getByLabel("Group name").fill("Kanchi Monthly 40K");
    await page.getByLabel(/Chit value/).fill("40000");
    await page.getByLabel(/Members \/ tickets/).fill("4");
    await expect(page.getByText("Chit value ÷ members = ₹10,000")).toBeVisible();
    await page.getByLabel(/Monthly subscription/).fill("9000");
    await expect(page.getByRole("alert").filter({ hasText: "must equal the chit value" })).toBeVisible();
    await page.getByLabel(/Monthly subscription/).fill("10000");
    await expect(page.getByText(/winner receives/)).toBeVisible();
    await page.getByRole("button", { name: "Create group" }).click();

    await expect(page.getByRole("heading", { name: "Kanchi Monthly 40K" })).toBeVisible();
    await page.getByRole("button", { name: "Open for enrolment" }).click();
    await expect(page.getByText("Open for enrolment").first()).toBeVisible();

    // Enrol four verified customers from the demo data
    await page.getByRole("tab", { name: "Members" }).click();
    for (const name of ["Arun", "Meena", "Karthik", "Lakshmi"]) {
      await page.getByRole("button", { name: "Add member" }).click();
      await page.getByLabel("Search customers to add").fill(name);
      await page
        .getByRole("button", { name: new RegExp(`^${name}`) })
        .first()
        .click();
      await expect(page.getByText("Member enrolled")).toBeVisible();
      await page
        .getByText("Member enrolled")
        .waitFor({ state: "hidden" })
        .catch(() => undefined);
    }
    await expect(page.getByText("4 of 4 seats filled")).toBeVisible();

    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("button", { name: "Start chit" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start chit" }).click();
    await expect(page.getByText("Running").first()).toBeVisible();

    // Month 1 auction: ticket 2 bids Rs 8,000, ticket 3 bids Rs 6,000
    await page.getByRole("tab", { name: "Auction" }).click();
    await page.getByLabel("Bidder (ticket)").selectOption({ index: 2 });
    await page.getByLabel(/Discount bid/).fill("1000");
    await page.getByRole("button", { name: "Record bid" }).click();
    await expect(page.getByText("Bid not accepted")).toBeVisible(); // below the 5% commission
    await page.getByLabel(/Discount bid/).fill("8000");
    await page.getByRole("button", { name: "Record bid" }).click();
    await expect(page.getByText("Bid recorded")).toBeVisible();
    await page.getByLabel("Bidder (ticket)").selectOption({ index: 3 });
    await page.getByLabel(/Discount bid/).fill("6000");
    await page.getByRole("button", { name: "Record bid" }).click();
    await expect(page.getByRole("row", { name: /₹6,000/ })).toBeVisible();

    await page.getByRole("button", { name: "Close month 1 and declare winner" }).click();
    await expect(page.getByRole("dialog")).toContainText("₹32,000");
    await page.getByRole("button", { name: "Close and declare winner" }).click();
    await expect(page.getByText("Auction closed")).toBeVisible();
    const sheet = page.locator("#auction-sheet");
    await expect(sheet).toContainText("Prize payable to winner");
    await expect(sheet).toContainText("₹32,000");
    await expect(sheet).toContainText("₹8,500"); // each member pays 10,000 less a 1,500 dividend
    await expect(sheet).toContainText("₹1,500");

    // Collections: take a payment from ticket 1
    await page.getByRole("tab", { name: "Collections" }).click();
    await page.getByRole("button", { name: "Collect from ticket 1" }).click();
    await expect(page.getByRole("dialog")).toContainText("₹8,500");
    await page.getByRole("button", { name: /^Record ₹8,500/ }).click();
    await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(/RCP\d{6}/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Outstanding").first()).toBeVisible();

    // Prize payout: the security check is mandatory; the winner's own dues are set off
    await page.getByRole("tab", { name: "Payouts" }).click();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("button", { name: "Approve payout" })).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Approve payout" }).click();
    await expect(page.getByRole("row", { name: /Approved/ })).toContainText("₹23,500"); // 32,000 prize - 8,500 set off
    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("button", { name: /Confirm payment of ₹23,500/ }).click();
    await expect(page.getByRole("row", { name: /Paid/ })).toBeVisible();

    // The winner's passbook shows the prize
    await page.getByRole("tab", { name: "Members" }).click();
    await page
      .locator("[role=status]")
      .first()
      .click({ trial: false })
      .catch(() => undefined); // dismiss any toast covering the table
    await expect(page.locator("[role=status]")).toHaveCount(0);
    await page.getByRole("link", { name: "Passbook for ticket 2" }).click();
    await expect(page.getByText("Prize won in month 1")).toBeVisible();
    await expect(page.getByRole("row", { name: /★ won/ })).toBeVisible();
  });

  test("Dashboard shows money, chit and customer figures, with a table view for the chart", async ({ page }) => {
    await signIn(page, SUPER_EMAIL, NEW_PASSWORD, totpSecret);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    for (const label of [
      "Collected today",
      "Collected this month",
      "Overdue",
      "Cash and bank",
      "Active customers",
      "Running chit groups",
      "KYC pending",
      "High-risk customers",
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // the chit test collected Rs 8,500 today, so this month is not empty; demo data has a member in arrears
    await expect(page.getByText("Collected this month").locator("xpath=following-sibling::p[1]")).not.toHaveText("₹0");
    await expect(
      page.getByText("Overdue", { exact: true }).first().locator("xpath=following-sibling::p[1]"),
    ).not.toHaveText("₹0");

    await expect(page.getByRole("img", { name: "Collections by month for the last six months" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overdue ageing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top defaulters" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming auctions" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Overdue amount by days past due" }).getByRole("listitem")).toHaveCount(
      4,
    );

    // the same numbers are available as a table
    await page.getByText("View as table").first().click();
    await expect(page.getByRole("table").filter({ hasText: "Collected" })).toBeVisible();

    // KPI tiles link through to the module
    await page.getByRole("link", { name: /Running chit groups/ }).click();
    await expect(page.getByRole("heading", { name: "Chit Funds" })).toBeVisible();
  });
});
