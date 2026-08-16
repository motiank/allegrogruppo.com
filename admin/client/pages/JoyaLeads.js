import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table';
import axios from 'axios';
import { useTheme } from '../context/ThemeContext';

const STATUS_LABEL = { new: 'New', contacted: 'Contacted', closed: 'Closed' };

const fmtDate = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
};

const JoyaLeads = () => {
  const { theme } = useTheme();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ status: 'new', notes: '' });
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchLeads = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/admin/joya-leads', { withCredentials: true });
      if (res.data.meta?.err) {
        setError(res.data.meta.err);
        setLeads([]);
      } else {
        setLeads(res.data.rows || []);
      }
    } catch (err) {
      setError(err.response?.data?.meta?.err || err.message || 'Failed to fetch leads');
      setLeads([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const openHandle = (row) => {
    setEditing(row);
    setForm({ status: row.status || 'new', notes: row.notes || '' });
    setSubmitError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setSubmitError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await axios.put(
        `/admin/joya-leads/${editing.id}`,
        { status: form.status, notes: form.notes.trim() || null },
        { withCredentials: true },
      );
      if (res.data.meta?.err) {
        setSubmitError(res.data.meta.err);
        return;
      }
      closeModal();
      fetchLeads();
    } catch (err) {
      setSubmitError(err.response?.data?.meta?.err || err.message || 'Request failed');
    } finally {
      setSaving(false);
    }
  };

  const filteredData = useMemo(() => {
    let rows = leads;
    if (statusFilter) rows = rows.filter((l) => l.status === statusFilter);
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (l) =>
          (l.name || '').toLowerCase().includes(q) ||
          (l.phone || '').includes(q) ||
          (l.email || '').toLowerCase().includes(q) ||
          (l.branch || '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [leads, searchTerm, statusFilter]);

  const statusBadge = (status) => {
    const colors = {
      new: { bg: theme.warningBg, fg: theme.warningText || theme.warning, border: theme.warningBorder },
      contacted: { bg: theme.info + '22', fg: theme.info, border: theme.info },
      closed: { bg: theme.successBg, fg: theme.success, border: theme.successBorder },
    };
    const c = colors[status] || colors.new;
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          backgroundColor: c.bg,
          color: c.fg,
          border: `1px solid ${c.border}`,
        }}
      >
        {STATUS_LABEL[status] || status}
      </span>
    );
  };

  const columns = useMemo(
    () => [
      { accessorKey: 'created_at', header: 'Received', cell: (info) => fmtDate(info.getValue()) },
      { accessorKey: 'name', header: 'Name', cell: (info) => info.getValue() || '-' },
      { accessorKey: 'phone', header: 'Phone', cell: (info) => info.getValue() || '-' },
      { accessorKey: 'email', header: 'Email', cell: (info) => info.getValue() || '-' },
      { accessorKey: 'branch', header: 'Branch', cell: (info) => info.getValue() || '-' },
      { accessorKey: 'guests', header: 'Guests', cell: (info) => info.getValue() ?? '-' },
      { accessorKey: 'event_date', header: 'Event date', cell: (info) => info.getValue() || '-' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: (info) => statusBadge(info.getValue()),
      },
      {
        id: 'actions',
        header: '',
        cell: (info) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openHandle(info.row.original);
            }}
            onMouseEnter={(e) => { e.target.style.backgroundColor = theme.activeBg; }}
            onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '6px 10px',
              color: theme.info,
              borderRadius: '4px',
              fontSize: '14px',
            }}
          >
            Handle
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const getStyles = () => ({
    container: { maxWidth: '1200px', margin: '0 auto', padding: '20px' },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px',
      flexWrap: 'wrap',
      gap: '16px',
    },
    title: { fontSize: '1.5rem', fontWeight: '600', color: theme.text, margin: 0 },
    headerRight: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
    searchInput: {
      padding: '8px 12px',
      border: `1px solid ${theme.border}`,
      borderRadius: '6px',
      fontSize: '14px',
      fontFamily: 'inherit',
      backgroundColor: theme.surface,
      color: theme.text,
      minWidth: '200px',
    },
    select: {
      padding: '8px 12px',
      border: `1px solid ${theme.border}`,
      borderRadius: '6px',
      fontSize: '14px',
      fontFamily: 'inherit',
      backgroundColor: theme.surface,
      color: theme.text,
    },
    error: {
      backgroundColor: theme.errorBg,
      color: theme.error,
      padding: '12px',
      borderRadius: '6px',
      marginBottom: '20px',
      border: `1px solid ${theme.errorBorder}`,
    },
    tableContainer: {
      backgroundColor: theme.surface,
      borderRadius: '8px',
      boxShadow: `0 2px 4px ${theme.shadow}`,
      overflow: 'auto',
      border: `1px solid ${theme.border}`,
    },
    loading: { padding: '40px', textAlign: 'center', color: theme.textSecondary },
    empty: { padding: '40px', textAlign: 'center', color: theme.textTertiary },
    table: { width: '100%', borderCollapse: 'collapse' },
    tableHeaderRow: { backgroundColor: theme.surfaceSecondary || theme.hover, borderBottom: `2px solid ${theme.border}` },
    tableHeader: {
      padding: '12px 16px',
      textAlign: 'left',
      fontWeight: '600',
      color: theme.text,
      fontSize: '13px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      whiteSpace: 'nowrap',
    },
    tableRow: { borderBottom: `1px solid ${theme.borderLight || theme.border}` },
    tableCell: { padding: '12px 16px', fontSize: '14px', color: theme.textSecondary, whiteSpace: 'nowrap' },
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
    },
    modalContent: {
      backgroundColor: theme.surface,
      borderRadius: '8px',
      boxShadow: `0 4px 20px ${theme.shadow}`,
      maxWidth: '480px',
      width: '100%',
      border: `1px solid ${theme.border}`,
    },
    modalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px 20px',
      borderBottom: `1px solid ${theme.border}`,
    },
    modalTitle: { margin: 0, fontSize: '1.25rem', fontWeight: '600', color: theme.text },
    closeButton: {
      background: 'none',
      border: 'none',
      fontSize: '24px',
      cursor: 'pointer',
      color: theme.textSecondary,
      lineHeight: 1,
      padding: 0,
      width: '32px',
      height: '32px',
      borderRadius: '4px',
    },
    modalBody: { padding: '20px' },
    leadDetail: { fontSize: '14px', color: theme.textSecondary, marginBottom: '4px' },
    leadDetailLabel: { color: theme.textTertiary },
    formGroup: { marginBottom: '16px' },
    formLabel: { display: 'block', marginBottom: '6px', fontWeight: '500', color: theme.text, fontSize: '14px' },
    formInput: {
      width: '100%',
      padding: '10px 12px',
      border: `1px solid ${theme.border}`,
      borderRadius: '6px',
      fontSize: '14px',
      fontFamily: 'inherit',
      backgroundColor: theme.surface,
      color: theme.text,
      boxSizing: 'border-box',
    },
    modalFooter: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '10px',
      padding: '16px 20px',
      borderTop: `1px solid ${theme.border}`,
    },
    cancelButton: {
      padding: '8px 16px',
      border: `1px solid ${theme.border}`,
      borderRadius: '6px',
      fontSize: '14px',
      cursor: 'pointer',
      backgroundColor: 'transparent',
      color: theme.text,
    },
    saveButton: {
      padding: '8px 16px',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      backgroundColor: theme.primary,
      color: '#fff',
    },
  });

  const styles = getStyles();

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Joya Event Leads</h1>
        <div style={styles.headerRight}>
          <input
            type="text"
            placeholder="Search name, phone, email, branch..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={styles.select}
          >
            <option value="">All statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableContainer}>
        {loading ? (
          <div style={styles.loading}>Loading…</div>
        ) : filteredData.length === 0 ? (
          <div style={styles.empty}>
            {searchTerm || statusFilter ? 'No leads match your filters.' : 'No leads yet.'}
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} style={styles.tableHeaderRow}>
                  {hg.headers.map((h) => (
                    <th key={h.id} style={styles.tableHeader}>
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} style={styles.tableRow}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={styles.tableCell}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && editing && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>{editing.name}</h2>
              <button type="button" onClick={closeModal} style={styles.closeButton}>
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              {submitError && <div style={styles.error}>{submitError}</div>}
              <p style={styles.leadDetail}><span style={styles.leadDetailLabel}>Phone: </span>{editing.phone || '-'}</p>
              <p style={styles.leadDetail}><span style={styles.leadDetailLabel}>Email: </span>{editing.email || '-'}</p>
              <p style={styles.leadDetail}><span style={styles.leadDetailLabel}>Branch: </span>{editing.branch || '-'}</p>
              <p style={styles.leadDetail}><span style={styles.leadDetailLabel}>Guests: </span>{editing.guests ?? '-'}</p>
              <p style={styles.leadDetail}><span style={styles.leadDetailLabel}>Event date: </span>{editing.event_date || '-'}</p>
              <p style={styles.leadDetail}><span style={styles.leadDetailLabel}>Message: </span>{editing.message || '-'}</p>
              <p style={{ ...styles.leadDetail, marginBottom: '16px' }}>
                <span style={styles.leadDetailLabel}>Received: </span>{fmtDate(editing.created_at)}
              </p>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                  style={styles.formInput}
                >
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  style={{ ...styles.formInput, minHeight: '80px', resize: 'vertical' }}
                  placeholder="Internal notes about this lead..."
                />
              </div>
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={closeModal} style={styles.cancelButton}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{ ...styles.saveButton, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JoyaLeads;
