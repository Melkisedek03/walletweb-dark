import React, { useState } from 'react';
import {
  getAddressBookEntries,
  searchAddressBook,
  addAddressBookEntry,
  updateAddressBookEntry,
  deleteAddressBookEntry,
  type AddressBookEntry,
} from '../lib/addressbook';

interface AddressBookProps {
  onBack: () => void;
}

export function AddressBook({ onBack }: AddressBookProps) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<AddressBookEntry[]>(() => getAddressBookEntries());
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = query ? searchAddressBook(query) : entries;

  function refresh() {
    setEntries(getAddressBookEntries());
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    try {
      addAddressBookEntry(label, address);
      setLabel('');
      setAddress('');
      setError(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this entry');
    }
  }

  function startEdit(entry: AddressBookEntry) {
    setEditing(entry.address);
    setEditLabel(entry.label);
    setEditAddress(entry.address);
    setConfirmDelete(null);
    setError(null);
  }

  function handleEdit(e: React.FormEvent, oldAddress: string) {
    e.preventDefault();
    try {
      updateAddressBookEntry(oldAddress, editLabel, editAddress);
      setEditing(null);
      setError(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this entry');
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Address Book</h2>
      <p className="text-dark-400 text-sm">
        Labels and addresses are stored only in this browser. They are
        never sent to a server, and they do not move to a different
        domain if the wallet is self-hosted elsewhere.
      </p>

      <form onSubmit={handleAdd} className="card space-y-4">
        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2">Label</label>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. Savings, Exchange, Friend"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2">Address</label>
          <input
            type="text"
            className="input-field font-mono text-sm"
            placeholder="N/X/nu1q..."
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" className="btn-primary w-full">
          Add Entry
        </button>
      </form>

      <div>
        <label className="block text-sm font-medium text-dark-300 mb-2">Search</label>
        <input
          type="text"
          className="input-field"
          placeholder="Search by label or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-dark-400 text-sm">
          {query ? 'No entries match this search.' : 'No entries yet. Add a label and address above.'}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((entry) =>
            editing === entry.address ? (
              <form
                key={entry.address}
                onSubmit={(e) => handleEdit(e, entry.address)}
                className="card space-y-3"
              >
                <input
                  type="text"
                  className="input-field"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                />
                <input
                  type="text"
                  className="input-field font-mono text-sm"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value.trim())}
                />
                <div className="flex gap-3">
                  <button type="submit" className="btn-primary flex-1">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="btn-secondary flex-1">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div key={entry.address} className="card space-y-2">
                <p className="font-medium">{entry.label}</p>
                <p className="font-mono text-sm break-all text-dark-300">{entry.address}</p>
                <div className="flex gap-3">
                  <button onClick={() => startEdit(entry)} className="btn-secondary flex-1">
                    Edit
                  </button>
                  {confirmDelete === entry.address ? (
                    <button
                      onClick={() => {
                        deleteAddressBookEntry(entry.address);
                        setConfirmDelete(null);
                        refresh();
                      }}
                      className="btn-secondary flex-1 text-red-400"
                    >
                      Confirm Delete
                    </button>
                  ) : (
                    <button onClick={() => setConfirmDelete(entry.address)} className="btn-secondary flex-1">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      <button onClick={onBack} className="btn-secondary w-full">
        Back
      </button>
    </div>
  );
}
