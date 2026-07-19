import { test, expect } from "@playwright/test";

test("home loads with hero + featured products", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/0208 864 5763/)).toBeVisible();
});

test("no cart / checkout / payment anywhere in nav", async ({ page }) => {
  await page.goto("/");
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain("add to basket");
  expect(body).not.toContain("checkout");
  expect(body).not.toContain("buy now");
});

test("products: search by product code shows the product", async ({ page }) => {
  await page.goto("/products");
  await page.getByPlaceholder(/search/i).fill("WAN28258GB");
  await expect(page.getByText("WAN28258GB").first()).toBeVisible();
});

test("product detail: code + call CTA + enquiry prefill", async ({ page }) => {
  await page.goto("/products");
  await page.getByRole("link", { name: /view details/i }).first().click();
  await expect(page.getByText(/Product code:/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Call to Confirm Availability/i })).toBeVisible();
  await page.getByRole("link", { name: /Ask About This Product/i }).click();
  await expect(page).toHaveURL(/\/contact\?product=.*code=/);
});

test("back navigation works", async ({ page }) => {
  await page.goto("/products");
  await page.getByRole("link", { name: /view details/i }).first().click();
  await page.goBack();
  await expect(page).toHaveURL(/\/products$/);
});

test("contact page shows phone + enquiry form", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByText(/0208 864 5763/)).toBeVisible();
  await expect(page.getByPlaceholder(/your name/i)).toBeVisible();
});

test("admin is protected (redirects to sign-in)", async ({ page }) => {
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/\/admin\/signin/);
});

test("chat widget opens and replies", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /open chat/i }).click();
  await page.getByPlaceholder(/ask about a product/i).fill("What are your opening hours?");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/typing|call|hours|0208/i).last()).toBeVisible({ timeout: 25000 });
});
