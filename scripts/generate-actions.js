/**
 * Reads 47Kactions.csv, dedupes and filters to clear/unique actions,
 * detects city/place from title+description, assigns lat/lng from pan-India lookup.
 * Run: node scripts/generate-actions.js
 */

const fs = require("fs");
const path = require("path");

const CSV_PATH = path.join(__dirname, "../public/data/47Kactions.csv");
const OUT_PATH = path.join(__dirname, "../public/data/actions.json");

// Pan-India place names → approximate [lat, lng] (sort longer names first for matching)
const PLACE_COORDS = [
  ["Bengaluru", 12.9716, 77.5946],
  ["Bangalore", 12.9716, 77.5946],
  ["Karnataka", 15.3173, 75.7139],
  ["Chennai", 13.0827, 80.2707],
  ["Tamil Nadu", 11.1271, 78.6569],
  ["Kerala", 10.8505, 76.2711],
  ["Thiruvananthapuram", 8.5241, 76.9366],
  ["Kochi", 9.9312, 76.2673],
  ["Maharashtra", 19.076, 72.8777],
  ["Mumbai", 19.076, 72.8777],
  ["Pune", 18.5204, 73.8567],
  ["Nanded", 19.1532, 77.305],
  ["Punjab", 31.1471, 75.3412],
  ["Chandigarh", 30.7333, 76.7794],
  ["Ludhiana", 30.901, 75.8573],
  ["Mangalore", 12.9141, 74.856],
  ["Mangaluru", 12.9141, 74.856],
  ["Delhi", 28.7041, 77.1025],
  ["New Delhi", 28.6139, 77.209],
  ["Hyderabad", 17.385, 78.4867],
  ["Telangana", 18.1124, 79.0193],
  ["Kolkata", 22.5726, 88.3639],
  ["West Bengal", 22.9868, 87.855],
  ["Rajasthan", 27.0238, 74.2179],
  ["Jaipur", 26.9124, 75.7873],
  ["Gujarat", 22.2587, 71.1924],
  ["Ahmedabad", 23.0225, 72.5714],
  ["Uttar Pradesh", 26.8467, 80.9462],
  ["Lucknow", 26.8467, 80.9462],
  ["Bihar", 25.0961, 85.3131],
  ["Patna", 25.5941, 85.1376],
  ["Odisha", 20.9517, 85.0985],
  ["Bhubaneswar", 20.2961, 85.8245],
  ["Madhya Pradesh", 22.9734, 78.6569],
  ["Bhopal", 23.2599, 77.4126],
  ["Chhattisgarh", 21.2787, 81.8661],
  ["Raipur", 21.2514, 81.6296],
  ["Jharkhand", 23.6102, 85.2799],
  ["Ranchi", 23.3441, 85.3096],
  ["Assam", 26.2006, 92.9376],
  ["Guwahati", 26.1445, 91.7362],
  ["Nagaland", 26.1584, 94.5624],
  ["Kohima", 25.6741, 94.1086],
  ["Sikkim", 27.533, 88.5122],
  ["Gangtok", 27.3389, 88.6061],
  ["Chikkabavanar", 13.0, 77.58],
  ["Sarakki", 12.91, 77.58],
  ["Basaweshwar Nagar", 13.0, 77.55],
  ["Jigani", 12.78, 77.59],
  ["Dodda Changavi", 13.5, 76.5],
  ["Chikka Changavi", 13.5, 76.5],
  ["Marshettihalli", 13.08, 77.58],
  ["D Kunnala", 13.5, 76.5],
  ["Mukhed", 18.7, 77.35],
  ["Nationwide", 20.5937, 78.9629],
  ["India", 20.5937, 78.9629],
];
// Fallback cities when no place is detected (spread across India)
const FALLBACK_COORDS = [
  [12.9716, 77.5946],
  [19.076, 72.8777],
  [13.0827, 80.2707],
  [28.7041, 77.1025],
  [22.5726, 88.3639],
  [17.385, 78.4867],
  [26.9124, 75.7873],
  [10.8505, 76.2711],
  [31.1471, 75.3412],
  [23.0225, 72.5714],
];

// Map place names to ward_id so every action has a ward (WARD_1, WARD_2, WARD_3)
const PLACE_TO_WARD = {
  Bengaluru: "WARD_1", Bangalore: "WARD_1", Karnataka: "WARD_1", Mangalore: "WARD_1", Mangaluru: "WARD_1",
  Sarakki: "WARD_1", "Basaweshwar Nagar": "WARD_1", Jigani: "WARD_1", Chikkabavanar: "WARD_1",
  Chennai: "WARD_2", "Tamil Nadu": "WARD_2", Kerala: "WARD_2", Thiruvananthapuram: "WARD_2", Kochi: "WARD_2",
  "Dodda Changavi": "WARD_2", "Chikka Changavi": "WARD_2", Marshettihalli: "WARD_2", "D Kunnala": "WARD_2",
};
const WARD_IDS = ["WARD_1", "WARD_2", "WARD_3"];

function findPlaceCoords(title, description, location) {
  const text = [title, description, location].filter(Boolean).join(" ");
  const lower = text.toLowerCase();
  let matchedWard = WARD_IDS[0];
  for (const [place, lat, lng] of PLACE_COORDS) {
    if (lower.includes(place.toLowerCase())) {
      const offsetLat = (Math.random() - 0.5) * 0.04;
      const offsetLng = (Math.random() - 0.5) * 0.04;
      matchedWard = PLACE_TO_WARD[place] || WARD_IDS[Math.abs((place.length * 7) % 3)];
      return { lat: lat + offsetLat, lng: lng + offsetLng, place, ward_id: matchedWard };
    }
  }
  return null;
}

function parseCSVRows(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes) {
      if (c === ",") {
        current.push(field.trim());
        field = "";
        continue;
      }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        current.push(field.trim());
        field = "";
        if (current.some((cell) => cell.length > 0)) rows.push(current);
        current = [];
        continue;
      }
    }
    field += c;
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field.trim());
    if (current.some((cell) => cell.length > 0)) rows.push(current);
  }
  return rows;
}

function isDataRow(row) {
  if (!row || row.length < 8) return false;
  const name = (row[1] || "").trim();
  const title = (row[2] || "").trim();
  if (title.length < 3) return false;
  if (/^(Column Name|DocType|Mandatory|Type:|Info:)/.test(row[0])) return false;
  return name.length >= 4 && /[a-zA-Z0-9-]/.test(name);
}

function clean(s) {
  if (typeof s !== "string") return "";
  return s.replace(/^"+|"+$/g, "").trim();
}

function main() {
  console.log("Reading", CSV_PATH);
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCSVRows(text);
  console.log("Total rows parsed:", rows.length);

  const dataRows = rows.filter(isDataRow);
  console.log("Data rows (after template skip):", dataRows.length);

  const seen = new Set();
  const unique = [];
  for (const row of dataRows) {
    const name = clean(row[1]);
    const title = clean(row[2]);
    const type = clean(row[3]);
    const category = clean(row[5]);
    const description = clean(row[7]);
    const location = clean(row[18]);
    const creation = clean(row[10]);

    if (title.length < 5 || !category) continue;
    if (description.length < 15) continue;
    const key = `${title.toLowerCase().slice(0, 80)}|${category.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    unique.push({
      name,
      title,
      type,
      category,
      description: description.slice(0, 300),
      location: location || null,
      creation: creation || null,
    });
  }

  console.log("Unique & clear actions:", unique.length);

  const MAX_ACTIONS = 1200;
  const selected = unique.slice(0, MAX_ACTIONS);

  let matched = 0;
  const out = selected.map((a, i) => {
    const coords = findPlaceCoords(a.title, a.description, a.location);
    let lat, lng, place_name, ward_id;
    if (coords) {
      matched++;
      lat = coords.lat;
      lng = coords.lng;
      place_name = coords.place;
      ward_id = coords.ward_id || WARD_IDS[i % 3];
    } else {
      const fallback = FALLBACK_COORDS[i % FALLBACK_COORDS.length];
      const offsetLat = (Math.random() - 0.5) * 0.06;
      const offsetLng = (Math.random() - 0.5) * 0.06;
      lat = fallback[0] + offsetLat;
      lng = fallback[1] + offsetLng;
      place_name = null;
      ward_id = WARD_IDS[i % 3];
    }
    return {
      id: a.name || `action-${i}`,
      title: a.title,
      type: a.type,
      category: a.category,
      description: a.description,
      location: a.location,
      creation: a.creation,
      latitude: lat,
      longitude: lng,
      place_name,
      ward_id,
    };
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 0), "utf8");
  console.log("Wrote", out.length, "actions to", OUT_PATH);
  console.log("Matched to place:", matched, "| Fallback (spread):", out.length - matched);
}

main();
