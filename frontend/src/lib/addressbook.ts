// Local address book. This stores only public recipient data: a
// label and an address. It never stores mnemonics or private keys,
// and it is never sent to any server or to the electrs service.
// Storage is this browser's localStorage, scoped per origin, so an
// address book does not move with the static files to a different
// self-hosted domain. All operations are best-effort: a storage
// failure must never block sending a transaction.

export interface AddressBookEntry {
  address: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
}

const STORAGE_KEY = 'nux_addressbook_v1';

const ADDRESS_RE = /^[NX][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const ADDRESS_BECH = /\bnu1[qQ][a-zA-HJ-NP-Z0-9]{25,39}\b/;

export function isValidNusacoinAddress(address: string): boolean {
  return ADDRESS_RE.test(address) || ADDRESS_BECH.test(address);
}

function loadEntries(): AddressBookEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is AddressBookEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as AddressBookEntry).address === 'string' &&
        typeof (e as AddressBookEntry).label === 'string' &&
        isValidNusacoinAddress((e as AddressBookEntry).address),
    );
  } catch {
    return [];
  }
}

function saveEntries(entries: AddressBookEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: the address book is best-effort.
  }
}

function byLabel(a: AddressBookEntry, b: AddressBookEntry): number {
  return a.label.localeCompare(b.label) || a.address.localeCompare(b.address);
}

export function getAddressBookEntries(): AddressBookEntry[] {
  return loadEntries().sort(byLabel);
}

export function searchAddressBook(query: string): AddressBookEntry[] {
  const q = query.trim().toLowerCase();
  const entries = getAddressBookEntries();
  if (!q) return entries;
  return entries.filter(
    (e) => e.label.toLowerCase().includes(q) || e.address.toLowerCase().includes(q),
  );
}

export function getAddressBookLabel(address: string): string | null {
  return loadEntries().find((e) => e.address === address)?.label ?? null;
}

export function addAddressBookEntry(label: string, address: string): void {
  const cleanLabel = label.trim();
  const cleanAddress = address.trim();
  if (!cleanLabel) throw new Error('Label is required');
  if (!isValidNusacoinAddress(cleanAddress)) throw new Error('Invalid Nusacoin address');
  const entries = loadEntries();
  if (entries.some((e) => e.address === cleanAddress)) {
    throw new Error('This address is already in the address book');
  }
  entries.push({ address: cleanAddress, label: cleanLabel, createdAt: Date.now(), lastUsedAt: Date.now() });
  saveEntries(entries);
}

export function updateAddressBookEntry(
  oldAddress: string,
  label: string,
  newAddress: string,
): void {
  const cleanLabel = label.trim();
  const cleanAddress = newAddress.trim();
  if (!cleanLabel) throw new Error('Label is required');
  if (!isValidNusacoinAddress(cleanAddress)) throw new Error('Invalid Nusacoin address');
  const entries = loadEntries();
  if (cleanAddress !== oldAddress && entries.some((e) => e.address === cleanAddress)) {
    throw new Error('This address is already in the address book');
  }
  const entry = entries.find((e) => e.address === oldAddress);
  if (!entry) throw new Error('Address not found in the address book');
  entry.label = cleanLabel;
  entry.address = cleanAddress;
  saveEntries(entries);
}

export function deleteAddressBookEntry(address: string): void {
  saveEntries(loadEntries().filter((e) => e.address !== address));
}

export function touchAddressBookEntry(address: string): void {
  const entries = loadEntries();
  const entry = entries.find((e) => e.address === address);
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  saveEntries(entries);
}
