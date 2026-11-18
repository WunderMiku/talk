import { startServer } from "../../tests/lib/server.mjs";
import { chromium } from "playwright";
const raw = `荒诞里带一点蛛丝马迹，通常拆成两个层次写最稳。\n\n<c id="c1">faint traces of</c>\n比 hint 克制，适合书面叙述。\n\n<w id="w1">absurdity</w>\n指向处境本身的荒谬，而非人的愚蠢。\n\n<s id="s1">a surreal reality underpinned by subtle clues</s>\n把「超现实」和「有据可循」放在同一句里。\n\n\`\`\`json:cards\n{"c1":{"type":"chunk","text":"faint traces of","vibe":"书面 · 克制","verdict":"强调线索极轻"},"w1":{"type":"word","text":"absurdity","vibe":"哲学 · 中性","verdict":"处境的荒谬"},"s1":{"type":"sentence","text":"a surreal reality underpinned by subtle clues","vibe":"文学 · 精密","verdict":"现实感与逻辑并置"},"followups":["换成更口语的说法","放进雅思大作文里怎么用"]}\n\`\`\``;
const server = await startServer();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [name, viewport] of [["reverse", { width: 390, height: 844 }], ["reverse-wide", { width: 1366, height: 1024 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: "block" });
  await ctx.addInitScript(() => {
    localStorage.setItem("talk.model.v1", JSON.stringify({ remember:true, baseUrl:"https://stub.local/v1", apiKey:"sk-test-1234567890123456", model:"mock-model", activeProfileId:"stub", profiles:[{id:"stub", name:"stub", baseUrl:"https://stub.local/v1", apiKey:"sk-test-1234567890123456", model:"mock-model", protocol:"openai"}] }));
  });
  const page = await ctx.newPage();
  await page.route("https://stub.local/**", (route) => route.fulfill({ status:200, contentType:"application/json", body: JSON.stringify({ choices:[{message:{content: raw}}], usage:{total_tokens:300} }) }));
  await page.goto(server.origin + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#search-input");
  await page.fill("#search-input", "我想看看怎么表示一种感觉，及其荒诞但又有蛛丝马迹的事件");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".desk-item", { timeout: 20000 });
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    const pop = document.querySelector("#decision-popover");
    if (pop) { pop.hidden = true; pop.classList.remove("is-open"); pop.innerHTML = ""; }
    document.querySelector(".reverse-annotated")?.classList.remove("has-docket");
    document.querySelectorAll(".desk-pair.is-active").forEach((el) => el.classList.remove("is-active"));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `docs/screenshots/${name}.png` });
  await ctx.close();
}
await browser.close(); await server.stop();
