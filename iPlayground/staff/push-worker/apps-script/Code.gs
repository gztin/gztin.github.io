const SPREADSHEET_ID = "1cDhJIQ3r9l3MIeFITBnnqDkezvYM8IP8F7CiIPufjeU";

const DATASETS = Object.freeze({
  "d1-roster": { sheet: "D1排班", gid: "2038369112" },
  "d2-roster": { sheet: "D2排班", gid: "480476053" },
  "d1-tasks": { sheet: "D1", gid: "1514512883" },
  "d2-tasks": { sheet: "D2", gid: "984910202" }
});

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(event) {
  const expectedToken = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
  const suppliedToken = String(event && event.parameter && event.parameter.token || "");
  if (!expectedToken || suppliedToken !== expectedToken) {
    return jsonResponse({ ok: false, error: "Unauthorized" });
  }

  const dataset = String(event.parameter.dataset || "");
  const config = DATASETS[dataset];
  if (!config) {
    return jsonResponse({ ok: false, error: "Unknown dataset" });
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(config.sheet);
  if (!sheet) {
    return jsonResponse({ ok: false, error: "Sheet not found" });
  }

  return jsonResponse({
    ok: true,
    dataset: dataset,
    sheet: config.sheet,
    gid: config.gid,
    fetchedAt: new Date().toISOString(),
    values: sheet.getDataRange().getDisplayValues()
  });
}
