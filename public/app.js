// =============================================================
// Family Tree App — all of the app's logic lives in this file.
// =============================================================
//
// WHAT THIS APP DOES: shows family members as circles ("nodes")
// connected by lines. Lines going down connect parents to
// children. Horizontal lines connect spouses/partners to each
// other. Click a circle to see/edit that person's details.
//
// HOW MULTIPLE PEOPLE CAN EDIT AT THE SAME TIME: this app uses a
// "CRDT" (Conflict-free Replicated Data Type) — a data structure
// that knows how to automatically combine edits from different
// people, even if they typed at the exact same moment, without a
// human needing to resolve a conflict. The CRDT library we use is
// called "Yjs". We don't have to write any of that merging logic
// ourselves — Yjs does it for us.
//
// HOW EVERYONE STAYS IN SYNC: a small "WebSocket" server (a
// program that keeps an open, two-way connection with each
// browser tab) relays every change to every other connected tab.
// That server is `y-websocket`, and its code lives entirely in
// the `y-websocket` npm package — see README.md for how to run it.

// --- Imports from a CDN (Content Delivery Network) ------------
// Instead of installing these with npm and using a build tool,
// we import them straight from a public CDN URL. That keeps this
// app buildless: you can open this file in a browser with no
// compile step.
// Both of these packages need to share the exact same copy of Yjs
// internally, or their internal checks silently fail to notice
// each other's data. "yjs" below is a bare name — the browser
// resolves it using the <script type="importmap"> in index.html,
// which points it at one specific CDN file. `?external=yjs` tells
// esm.sh not to bundle its own copy of yjs into y-websocket, so it
// resolves "yjs" the same way, through that same import map, and
// both packages end up using the identical module.
import * as Y from "yjs";
import { WebsocketProvider } from "https://esm.sh/y-websocket@2?external=yjs";

// --- Connect to the shared, synced document --------------------
// Change SERVER_URL to point at a real server once you're hosting
// this for the family instead of running it on your own machine.
const SERVER_URL = "ws://localhost:1234";

// A Y.Doc is Yjs's "shared document" — think of it as a folder
// that automatically syncs itself with everyone else's copy.
const ydoc = new Y.Doc();

// The WebsocketProvider is what actually sends/receives changes
// over the network via the sync server. "family-tree" is just a
// room name — everyone using that same name shares the same tree.
new WebsocketProvider(SERVER_URL, "family-tree", ydoc);

// A Y.Map is a shared key/value store (like a JavaScript object)
// that lives inside the Y.Doc and syncs automatically. We store
// one entry per person, keyed by that person's id.
const people = ydoc.getMap("people");

// --- Layout constants -------------------------------------------
const NODE_RADIUS = 26;
const ROW_HEIGHT = 150; // vertical distance between generations
const MIN_SPACING = 90; // minimum horizontal distance between two people

// --- Small helpers -------------------------------------------------

// crypto.randomUUID() is built into every modern browser — no
// library needed to generate a unique id.
function generateId() {
  return "p_" + crypto.randomUUID();
}

function allPeopleEntries() {
  return Array.from(people.entries());
}

// Does `id` currently have anyone recorded as their child?
// Used to decide whether "Delete" should be allowed.
function hasChildren(id) {
  return allPeopleEntries().some(([, person]) => (person.parents || []).includes(id));
}

// Would making `candidateParentId` a parent of `childId` create a
// loop (e.g. A is B's parent, and B is already A's ancestor)?
// We check this by walking upward from candidateParentId through
// its own recorded parents, and seeing whether we ever reach
// childId. If we do, accepting the link would create a cycle.
function isAncestorOf(candidateAncestorId, personId, seen = new Set()) {
  if (personId === candidateAncestorId) return true;
  if (seen.has(personId)) return false; // already checked this branch
  seen.add(personId);
  const person = people.get(personId);
  if (!person) return false;
  return (person.parents || []).some((parentId) =>
    isAncestorOf(candidateAncestorId, parentId, seen)
  );
}

// ponytail: this app only ever links a *brand-new* person in as a
// parent/child/spouse (see addRelative below), so a cycle can't
// actually be created through the UI today. We still keep this
// check — and the matching guard in computeGenerations() — as
// cheap insurance, and because it's the first thing you'd need if
// a future "link to an existing person" feature is added.
function wouldCreateCycle(childId, candidateParentId) {
  if (childId === candidateParentId) return true;
  return isAncestorOf(childId, candidateParentId);
}

// --- Generation numbers (how many rows down from the top) ------
//
// A person's generation is 0 if they have no recorded parents,
// otherwise it's one more than their parents' generation. We
// compute this recursively, remembering answers we've already
// worked out (a "cache") so we don't redo the same work twice.
function computeGenerations() {
  const cache = new Map();

  function generationOf(id, currentlyVisiting) {
    if (cache.has(id)) return cache.get(id);

    // If we're already in the middle of computing this same id's
    // generation higher up the call stack, we've found a cycle in
    // the data (e.g. corrupted/imported data). Stop recursing and
    // just treat this person as generation 0 rather than looping
    // forever.
    if (currentlyVisiting.has(id)) return 0;

    const person = people.get(id);
    const parentIds = (person?.parents || []).filter((pid) => people.has(pid));

    if (parentIds.length === 0) {
      cache.set(id, 0);
      return 0;
    }

    currentlyVisiting.add(id);
    const generation =
      1 + Math.max(...parentIds.map((pid) => generationOf(pid, currentlyVisiting)));
    currentlyVisiting.delete(id);

    cache.set(id, generation);
    return generation;
  }

  const result = new Map();
  for (const id of people.keys()) {
    result.set(id, generationOf(id, new Set()));
  }

  // Someone with no recorded parents defaults to generation 0 —
  // right for a true founding ancestor, wrong for someone who
  // simply married into a later generation (the far more common
  // case). Pull anyone like that down to match their spouse's
  // generation instead. Repeat until nothing changes, since a
  // chain of such spouses could need more than one pass; each pass
  // only ever raises a generation number and there are finitely
  // many people, so this always finishes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of people.keys()) {
      const person = people.get(id);
      const hasRealParent = (person.parents || []).some((pid) => people.has(pid));
      if (hasRealParent) continue;
      for (const spouseId of person.spouses || []) {
        if (!people.has(spouseId)) continue;
        const spouseGeneration = result.get(spouseId);
        if (spouseGeneration > result.get(id)) {
          result.set(id, spouseGeneration);
          changed = true;
        }
      }
    }
  }

  return result;
}

// --- Horizontal (x) positions ------------------------------------
//
// ponytail: this is a simple heuristic, not a general tree/graph
// drawing algorithm. It works well for a family-sized tree: place
// each generation's row, guess each person's x from their
// parents' x, then nudge apart anyone left overlapping. If the
// tree grows very large or tangled and this starts looking messy,
// swap in a proper layout library (e.g. dagre/elk) at that point.
function computeLayout() {
  const generations = computeGenerations();

  const byGeneration = new Map();
  for (const [id, generation] of generations) {
    if (!byGeneration.has(generation)) byGeneration.set(generation, []);
    byGeneration.get(generation).push(id);
  }

  const maxGeneration = Math.max(0, ...byGeneration.keys());
  const positions = new Map(); // id -> x coordinate

  for (let generation = 0; generation <= maxGeneration; generation++) {
    const ids = byGeneration.get(generation) || [];

    // Place everyone in this row. Most people can be seeded from
    // their own parents' x position (average of both, if two are
    // recorded), or from a spouse's x position if they have no
    // recorded parents (e.g. someone who married in). But a spouse
    // can only be used as a seed once *that* spouse already has a
    // position — and a "root couple" (neither person has parents
    // recorded) starts with nothing to seed from at all. So this
    // runs as repeated passes: place whoever can be placed, and if
    // a whole pass places no one (everyone left is waiting on each
    // other), place just one of them arbitrarily to break the tie,
    // which then lets the rest follow from it.
    const remaining = new Set(ids);
    while (remaining.size > 0) {
      let placedSomeone = false;

      for (const id of remaining) {
        const person = people.get(id);
        const parentXs = (person.parents || [])
          .filter((pid) => positions.has(pid))
          .map((pid) => positions.get(pid));

        if (parentXs.length > 0) {
          positions.set(id, parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length);
          remaining.delete(id);
          placedSomeone = true;
          continue;
        }

        const positionedSpouse = (person.spouses || []).find((sid) => positions.has(sid));
        if (positionedSpouse !== undefined) {
          positions.set(id, positions.get(positionedSpouse) + MIN_SPACING);
          remaining.delete(id);
          placedSomeone = true;
        }
      }

      if (!placedSomeone) {
        const nextId = remaining.values().next().value;
        const usedXs = [...positions.values()];
        positions.set(nextId, (usedXs.length > 0 ? Math.max(...usedXs) : 0) + MIN_SPACING);
        remaining.delete(nextId);
      }
    }

    // Sweep left-to-right and push apart anyone too close together.
    ids.sort((a, b) => positions.get(a) - positions.get(b));
    for (let i = 1; i < ids.length; i++) {
      const previousX = positions.get(ids[i - 1]);
      if (positions.get(ids[i]) - previousX < MIN_SPACING) {
        positions.set(ids[i], previousX + MIN_SPACING);
      }
    }
  }

  return { generations, positions };
}

// --- Drawing the tree as SVG shapes --------------------------------

const svg = document.getElementById("tree");
const SVG_NS = "http://www.w3.org/2000/svg";

function drawLine(x1, y1, x2, y2) {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("class", "tree-edge");
  svg.appendChild(line);
}

function drawNode(id, x, y, person) {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "tree-node");
  group.addEventListener("click", () => openDialogFor(id));

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", x);
  circle.setAttribute("cy", y);
  circle.setAttribute("r", NODE_RADIUS);
  group.appendChild(circle);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", x);
  label.setAttribute("y", y + NODE_RADIUS + 16);
  label.setAttribute("text-anchor", "middle");
  label.textContent = person.name;
  group.appendChild(label);

  svg.appendChild(group);
}

function render() {
  // Clear and redraw everything. Family trees here are small
  // enough that a full redraw on every change is simpler — and
  // fast enough — than carefully patching individual shapes.
  svg.innerHTML = "";

  const { generations, positions } = computeLayout();
  const ids = Array.from(people.keys());

  if (ids.length === 0) return;

  const maxX = Math.max(...ids.map((id) => positions.get(id))) + 100;
  const maxGeneration = Math.max(...ids.map((id) => generations.get(id)));
  svg.setAttribute("viewBox", `0 0 ${maxX + 100} ${(maxGeneration + 1) * ROW_HEIGHT + 60}`);

  const yOf = (id) => generations.get(id) * ROW_HEIGHT + 60;

  // Parent -> child lines. Drawn before the circles so the lines
  // appear to go "into" the nodes rather than on top of them.
  for (const id of ids) {
    const person = people.get(id);
    // A stale id (referencing someone who was deleted) is simply
    // skipped here rather than crashing the whole drawing.
    const parentIds = (person.parents || []).filter((pid) => people.has(pid));
    if (parentIds.length === 0) continue;

    const parentXs = parentIds.map((pid) => positions.get(pid));
    const sourceX = parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length;
    const sourceY = yOf(parentIds[0]);
    drawLine(sourceX, sourceY, positions.get(id), yOf(id));
  }

  // Spouse <-> spouse lines. Each pair only needs to be drawn
  // once even though both people list each other as a spouse.
  const drawnPairs = new Set();
  for (const id of ids) {
    const person = people.get(id);
    for (const spouseId of person.spouses || []) {
      if (!people.has(spouseId)) continue; // stale id, skip
      const pairKey = [id, spouseId].sort().join("|");
      if (drawnPairs.has(pairKey)) continue;
      drawnPairs.add(pairKey);
      drawLine(positions.get(id), yOf(id), positions.get(spouseId), yOf(spouseId));
    }
  }

  // Nodes on top of the lines.
  for (const id of ids) {
    drawNode(id, positions.get(id), yOf(id), people.get(id));
  }
}

// Redraw any time the shared data changes — whether the change
// came from this browser tab or from someone else's.
people.observe(render);

// Also draw once immediately: if this tab already has synced data
// by the time this script runs (e.g. a fast reconnect), there is
// no "change" event to wait for.
render();

// --- The "add / edit person" popup ---------------------------------

const dialog = document.getElementById("person-dialog");
const form = document.getElementById("person-form");
const dialogTitle = document.getElementById("dialog-title");
const nameField = document.getElementById("field-name");
const birthField = document.getElementById("field-birth");
const deathField = document.getElementById("field-death");
const commentField = document.getElementById("field-comment");

// Which person the dialog is currently showing/editing.
let currentId = null;

function openDialogFor(id) {
  currentId = id;
  const person = people.get(id);
  dialogTitle.textContent = person.name;
  nameField.value = person.name;
  birthField.value = person.birthYear ?? "";
  deathField.value = person.deathYear ?? "";
  commentField.value = person.comment ?? "";
  dialog.showModal();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const person = people.get(currentId);
  people.set(currentId, {
    ...person,
    name: nameField.value,
    birthYear: birthField.value ? Number(birthField.value) : null,
    deathYear: deathField.value ? Number(deathField.value) : null,
    comment: commentField.value,
  });
  dialog.close();
});

document.getElementById("close-btn").addEventListener("click", () => dialog.close());

// --- Adding people (brand new person, first person, or a new relative) --

document.getElementById("add-person-btn").addEventListener("click", () => {
  const name = prompt("Name of the new person:");
  if (!name) return;
  const id = generateId();
  people.set(id, {
    id,
    name,
    birthYear: null,
    deathYear: null,
    comment: "",
    parents: [],
    spouses: [],
  });
});

// Creates a brand-new person and links them to the person the
// dialog is currently open on. `kind` is "spouse", "child", or
// "parent".
//
// skipped: linking an *existing* person in as a spouse/parent
// (e.g. when two branches of the family marry each other) —
// today each of these buttons always creates a new person. Add a
// "pick an existing person" option here if merged family lines
// come up.
function addRelative(kind) {
  const name = prompt(`Name of the new ${kind}:`);
  if (!name) return;

  const current = people.get(currentId);
  const newId = generateId();
  const newPerson = {
    id: newId,
    name,
    birthYear: null,
    deathYear: null,
    comment: "",
    parents: [],
    spouses: [],
  };

  if (kind === "spouse") {
    newPerson.spouses = [currentId];
    people.set(newId, newPerson);
    people.set(currentId, { ...current, spouses: [...(current.spouses || []), newId] });
  } else if (kind === "child") {
    // Link to the current person's spouse too (if they have one),
    // so the parent->child line in render() stems from the couple's
    // midpoint rather than from just one parent.
    const spouseId = (current.spouses || [])[0];
    newPerson.parents = spouseId ? [currentId, spouseId] : [currentId];
    people.set(newId, newPerson);
    // No change needed on either parent's own record — a child
    // links up to its parents, not the other way around.
  } else if (kind === "parent") {
    const existingParents = current.parents || [];
    if (existingParents.length >= 2) {
      alert("This person already has two parents recorded.");
      return;
    }
    if (wouldCreateCycle(currentId, newId)) {
      // Can't actually happen for a brand-new person, but this is
      // the same guard a future "link existing person" feature
      // would need, so it stays here rather than being deleted.
      alert("That link would create a loop in the tree.");
      return;
    }
    people.set(newId, newPerson);
    people.set(currentId, { ...current, parents: [...existingParents, newId] });
  }
}

document.getElementById("add-spouse-btn").addEventListener("click", () => addRelative("spouse"));
document.getElementById("add-child-btn").addEventListener("click", () => addRelative("child"));
document.getElementById("add-parent-btn").addEventListener("click", () => addRelative("parent"));

// --- Deleting a person -----------------------------------------------

document.getElementById("delete-btn").addEventListener("click", () => {
  if (hasChildren(currentId)) {
    alert("Can't delete this person — they still have a child recorded. Remove that link first.");
    return;
  }

  // "Unlink" delete: scrub this id out of every other person's
  // parents/spouses lists, so removing a mislinked or typo'd
  // person never leaves a dangling reference behind.
  for (const [otherId, other] of allPeopleEntries()) {
    if (otherId === currentId) continue;
    const parents = (other.parents || []).filter((pid) => pid !== currentId);
    const spouses = (other.spouses || []).filter((sid) => sid !== currentId);
    if (parents.length !== (other.parents || []).length || spouses.length !== (other.spouses || []).length) {
      people.set(otherId, { ...other, parents, spouses });
    }
  }

  people.delete(currentId);
  dialog.close();
});
