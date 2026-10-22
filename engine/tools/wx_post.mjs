// Fill one 视频号 post in Ego Lite (profile WX_VIDEOS, already logged in) and optionally click 发表.
// Run through tools/wx_post.sh, which substitutes __RUN__ / __PUBLISH__ (ego-browser nodejs gets no argv/env).
// Screenshots go to <run>/publish_*.png for a look before/after.
const RUN = "__RUN__", PUBLISH = "__PUBLISH__" === "1", AT = "__AT__", DATE = "__DATE__";   // AT: "HH:MM", or empty = publish now; DATE: "YYYY-MM-DD" (same month as today), or empty = today
const fs = await import("node:fs/promises");
const t = JSON.parse(await fs.readFile(`${RUN}/topic.json`, "utf8"));
const desc = `${t.intro}\n${t.tags.join(" ")}`;   // copy verbatim; tags become topics
// 短标题 rejects commas etc. (allowed: 《》“”：+？%°), so join the two title lines with a space
// 短标题上限 16 字，且符号只许 《》“”：+？%°（逗号用空格代替；小数点等其他符号整条报错）
// 候选：两行加空格 → 去空格 → 第一行 → 第二行，取第一个合规的；都不合规就删掉非法符号后截断第一行
const lines = t.title.map((s) => s.replace(/[，。,！!、；;]+$/u, "").replace(/[，,、；;]/gu, " "));
const legal = (s) => [...s].length <= 16 && /^[\p{Script=Han}A-Za-z0-9 《》“”：+？%°]+$/u.test(s);
const short = [lines.join(" "), lines.join(""), lines[0], lines[1]].find(legal)
  ?? [...lines[0].replace(/[^\p{Script=Han}A-Za-z0-9 《》“”：+？%°]/gu, "")].slice(0, 16).join("");

const spaces = await listTaskSpaces();
const mine = spaces.find((s) => s.name === "wx-video publish" && s.profileName === "WX_VIDEOS");
let task;
if (mine) {
  task = mine.ownership === "agentDelegatedToUser"
    ? await takeOverTaskSpace(mine.id)
    : await taskSpace(mine.id);
} else {
  task = await taskSpace("wx-video publish", { profileId: (await profiles()).find((p) => p.name === "WX_VIDEOS").id });
}
const page = task.page("p1");
// page elements live in shadow roots; click the centre of the first visible match (layout differs per window size)
async function clickEl(sel, label, text = null) {
  const c = await page.evaluate(([sel, text]) => {
    const all = []; const walk = (root) => root.querySelectorAll("*").forEach((el) => { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); }); walk(document);
    const e = all.find((x) => x.matches(sel) && x.getBoundingClientRect().width > 0 && (!text || x.textContent.trim() === text));
    if (!e) return null; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, [sel, text]);
  if (!c) throw new Error(`element not found: ${sel} ${text ?? ""}`);
  await page.mouse.click(c.x, c.y, { label });
}
await page.goto("https://channels.weixin.qq.com/platform/post/create");
await page.waitForTimeout(3000);
if ((await page.url()).includes("login")) { console.log("NEED LOGIN: 在 WX_VIDEOS 窗口登录视频号助手后重跑"); await task.handOff(); process.exit(3); }

await page.waitForSelector('input[type=file][accept^="video"]', { state: "attached", timeout: 30000 });
await page.setInputFiles('input[type=file][accept^="video"]', [`${RUN}/out/upload.mp4`]);
await page.waitForSelector("text=封面预览", { state: "visible", timeout: 300000 });
await page.waitForTimeout(3000);
// description: contenteditable .input-editor (its placeholder node is zero-size, so click the editor itself)
await clickEl(".input-editor", "focus description box");
await page.waitForTimeout(400);
await page.keyboard.paste(desc);
await page.waitForTimeout(800);
await page.fill('input[placeholder="填写短标题有机会获得更多流量"]', short);
await page.waitForTimeout(800);
// location: Operator wants none ("不显示位置" is the first option of the location dropdown)
await clickEl(".post-position-wrap .position-display", "open location dropdown");
await page.waitForTimeout(1200);
await clickEl(".location-item-info .name", "choose no location", "不显示位置");
await page.waitForTimeout(3000);

// cover: the 编辑 overlay ignores clicks for a few seconds after the form changes; retry until the dialog opens
let opened = false;
for (let k = 0; k < 5 && !opened; k++) {
  await clickEl(".edit-btn", "open cover editor");
  opened = await page.waitForSelector("text=编辑封面", { state: "visible", timeout: 6000 }).then(() => true, () => false);
}
if (!opened) { await page.screenshot({ path: `${RUN}/publish_fail.png` }); console.log("COVER DIALOG DID NOT OPEN"); process.exit(4); }
await page.setInputFiles('input[type=file][accept^="image"]', [`${RUN}/out/cover_1080x1440.png`]);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${RUN}/publish_cover.png` });
await page.click('text="确认"', { label: "confirm cover crop" });
await page.waitForTimeout(1500);
await page.click("text=选择视频标注", { label: "open video annotation options" });
await page.waitForTimeout(1200);
await page.click('text="含AI生成内容"', { label: "choose AI-generated annotation" });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${RUN}/publish_form.png` });
const loc = await page.evaluate(() => { const all = []; const walk = (r) => r.querySelectorAll("*").forEach((el) => { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); }); walk(document);
  return all.some((e) => e.classList?.contains("not-display") && e.getBoundingClientRect().width > 0); });
if (!loc) { console.log("LOCATION NOT CLEARED"); process.exit(5); }
if (AT) {
  // 定时: radio → 发表时间 input opens a date panel (today preselected) → its 时间 input opens hour/minute lists
  const [hh, mm] = AT.split(":");
  const pick = async (kind, text, label) => {
    const c = await page.evaluate(([kind, text]) => {
      const all = []; const walk = (r) => r.querySelectorAll("*").forEach((el) => { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); }); walk(document);
      const e = kind === "input" ? all.find((x) => x.tagName === "INPUT" && x.placeholder === text && x.getBoundingClientRect().width > 0)
        : all.find((x) => x.tagName === "LI" && x.parentElement?.className.includes("time__" + kind) && x.textContent.trim() === text && !x.className.includes("disabled"));
      if (!e) return null; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, [kind, text]);
    if (!c) throw new Error(`schedule: ${kind} ${text} not found/disabled`);
    await page.mouse.click(c.x, c.y, { label }); await page.waitForTimeout(700);
  };
  await page.click('text="定时"', { label: "choose scheduled publish" }); await page.waitForTimeout(1200);
  await pick("input", "请选择发表时间", "open date panel");
  if (DATE) {
    // day cells: <a> inside tr.weui-desktop-picker__table-row; other-month cells are __faded, out-of-range ones __disabled
    const day = String(+DATE.slice(8, 10));
    const c = await page.evaluate((day) => {
      const all = []; const walk = (r) => r.querySelectorAll("*").forEach((el) => { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); }); walk(document);
      const e = all.find((x) => x.tagName === "A" && x.closest("tr")?.className.includes("picker__table-row") && x.textContent.trim() === day
        && !x.className.includes("faded") && !x.className.includes("disabled") && x.getBoundingClientRect().width > 0);
      if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, day);
    if (!c) throw new Error(`schedule: day ${DATE} not selectable`);
    await page.mouse.click(c.x, c.y, { label: `pick day ${DATE}` }); await page.waitForTimeout(700);
  }
  await pick("input", "请选择时间", "open time lists");
  await pick("hour", hh, `pick hour ${hh}`);
  await pick("minute", mm, `pick minute ${mm}`);
  await page.click('text="发表时间"', { label: "close date panel" }); await page.waitForTimeout(800);
  const v = await page.evaluate(() => { const all = []; const walk = (r) => r.querySelectorAll("*").forEach((el) => { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); }); walk(document);
    return all.find((x) => x.tagName === "INPUT" && x.placeholder === "请选择发表时间")?.value; });
  await page.screenshot({ path: `${RUN}/publish_form.png` });
  if (!v?.endsWith(` ${AT}`) || (DATE && !v.startsWith(DATE))) { console.log("SCHEDULE NOT SET", v); process.exit(6); }
  console.log("scheduled for", v);
}
console.log({ issue: t._issue, short, filled: true });

if (PUBLISH) {
  await page.click('loc=role:button[name="发表"]', { label: "publish the video post" });
  await page.waitForURL(/post\/list/, { timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${RUN}/publish_list.png` });
  console.log("PUBLISHED", new Date().toISOString());
} else {
  await task.handOff();
  console.log("FILLED, waiting for the Operator to press 发表");
}
