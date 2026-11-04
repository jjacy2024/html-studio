// Import warnings are part of the user flow. Other regression suites acknowledge
// only this dialog; compatibility.test.mjs asserts its content and actions.
export async function acknowledgeCompatibility(page) {
  await page.waitForFunction(() => !htmlStudio.loading && htmlStudio.compatibility !== null);
  const notice = page.locator('#dialog[data-kind="compatibility"][open]');
  if (await notice.count()) await notice.getByRole('button', {name:'知道了，继续编辑',exact:true}).click();
}
