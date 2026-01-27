import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table';
import axios from 'axios';
import { useTheme } from '../context/ThemeContext';

const Affiliates = () => {
  const { theme } = useTheme();
  const [affiliates, setAffiliates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', affiliate_code: '' });
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchAffiliates = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/admin/affiliates', { withCredentials: true });
      if (res.data.meta?.err) {
        setError(res.data.meta.err);
        setAffiliates([]);
      } else {
        setAffiliates(res.data.rows || []);
      }
    } catch (err) {
      setError(err.response?.data?.meta?.err || err.message || 'Failed to fetch affiliates');
      setAffiliates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAffiliates();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', phone: '', affiliate_code: '' });
    setSubmitError(null);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || '',
      phone: row.phone ?? '',
      affiliate_code: row.affiliate_code ?? '',
    });
    setSubmitError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm({ name: '', phone: '', affiliate_code: '' });
    setSubmitError(null);
  };

  const handleFormChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setSubmitError('Name is required');
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      if (editing) {
        const res = await axios.put(`/admin/affiliates/${editing.affiliate_id}`, {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          affiliate_code: form.affiliate_code.trim().slice(0, 8) || null,
        }, { withCredentials: true });
        if (res.data.meta?.err) {
          setSubmitError(res.data.meta.err);
          return;
        }
      } else {
        const res = await axios.post('/admin/affiliates', {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          affiliate_code: form.affiliate_code.trim().slice(0, 8) || null,
        }, { withCredentials: true });
        if (res.data.meta?.err) {
          setSubmitError(res.data.meta.err);
          return;
        }
      }
      closeModal();
      fetchAffiliates();
    } catch (err) {
      setSubmitError(err.response?.data?.meta?.err || err.message || 'Request failed');
    } finally {
      setSaving(false);
    }
  };

  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return affiliates;
    const q = searchTerm.toLowerCase();
    return affiliates.filter(
      (a) =>
        (a.name || '').toLowerCase().includes(q) ||
        (a.phone || '').includes(q) ||
        (a.affiliate_code || '').toLowerCase().includes(q)
    );
  }, [affiliates, searchTerm]);

  const columns = useMemo(
    () => [
      { accessorKey: 'affiliate_id', header: 'ID', cell: (info) => `#${info.getValue()}` },
      { accessorKey: 'name', header: 'Name', cell: (info) => info.getValue() || '-' },
      { accessorKey: 'phone', header: 'Phone', cell: (info) => info.getValue() || '-' },
      { accessorKey: 'affiliate_code', header: 'Code', cell: (info) => info.getValue() || '-' },
      {
        id: 'actions',
        header: '',
        cell: (info) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(info.row.original);
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
            Edit
          </button>
        ),
      },
    ],
    [theme]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const getStyles = () => ({
    container: { maxWidth: '1000px', margin: '0 auto', padding: '20px' },
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
    addButton: {
      padding: '8px 16px',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      backgroundColor: theme.primary,
      color: '#fff',
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
      overflow: 'hidden',
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
      fontSize: '14px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    tableRow: { borderBottom: `1px solid ${theme.borderLight || theme.border}` },
    tableRowHover: { backgroundColor: theme.hover },
    tableCell: { padding: '12px 16px', fontSize: '14px', color: theme.textSecondary },
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
      maxWidth: '440px',
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
        <h1 style={styles.title}>Affiliates</h1>
        <div style={styles.headerRight}>
          <input
            type="text"
            placeholder="Search name, phone, code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          <button type="button" onClick={openAdd} style={styles.addButton}>
            Add affiliate
          </button>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableContainer}>
        {loading ? (
          <div style={styles.loading}>Loading…</div>
        ) : filteredData.length === 0 ? (
          <div style={styles.empty}>
            {searchTerm ? 'No affiliates match your search.' : 'No affiliates yet. Add one to get started.'}
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
                <tr
                  key={row.id}
                  style={styles.tableRow}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = styles.tableRowHover.backgroundColor; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
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

      {modalOpen && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>{editing ? 'Edit affiliate' : 'Add affiliate'}</h2>
              <button
                type="button"
                onClick={closeModal}
                onMouseEnter={(e) => { e.target.style.backgroundColor = theme.hover; e.target.style.color = theme.text; }}
                onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.color = theme.textSecondary; }}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              {submitError && <div style={styles.error}>{submitError}</div>}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  style={styles.formInput}
                  placeholder="Affiliate name"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Phone</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => handleFormChange('phone', e.target.value)}
                  style={styles.formInput}
                  placeholder="Phone number"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Affiliate code (max 8)</label>
                <input
                  type="text"
                  value={form.affiliate_code}
                  onChange={(e) => handleFormChange('affiliate_code', e.target.value)}
                  style={styles.formInput}
                  placeholder="Up to 8 characters"
                  maxLength={8}
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

export default Affiliates;
