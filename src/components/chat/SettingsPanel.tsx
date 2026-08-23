import React, { useEffect, useState } from 'react';
import { Plug, Search } from 'lucide-react';
import McpServersPanel from './McpServersPanel';
import LibreChatPanel from './LibreChatPanel';
import { GraduationCap, ImagePlus, Loader2, Palette, Save, Settings as SettingsIcon, Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import {
  GRADING_COUNTRY_OPTIONS,
  SCHOOL_LEVEL_OPTIONS,
  saveSchoolSettings,
  type SchoolSettings,
} from '@/lib/settings';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (file.size > MAX_LOGO_BYTES) {
      reject(new Error('Logo must be 2MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });

const inputClass =
  'w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400';

const SettingsPanel: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const { settings, refreshSettings } = useSettings();
  const [form, setForm] = useState<SchoolSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'branding' | 'mcp' | 'integrations'>('branding');

  // Keep the form in sync when the global settings load/refresh.
  useEffect(() => {
    setForm(settings);
  }, [settings]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900 p-8 text-center">
        <Shield className="w-10 h-10 text-indigo-500 mb-3" />
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">Admin Access Required</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Only administrators can change the school settings.</p>
      </div>
    );
  }

  const set = (key: keyof SchoolSettings) => (value: string) => {
    setForm(current => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const selectedLevel = SCHOOL_LEVEL_OPTIONS.find(option => option.value === form.school_level);

  const onLogo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      set('logo')(await readFileAsDataUrl(file));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read the logo.');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveSchoolSettings(form, user);
      await refreshSettings();
      setSaved(true);
    } catch (err) {
      alert(`Failed to save settings: ${err instanceof Error ? err.message : 'Unexpected error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-indigo-500" />
          School Settings
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {tab === 'branding'
            ? 'Set the school identity used across report cards, receipts, statements, ID cards and the app header.'
            : tab === 'mcp'
              ? 'Connect external MCP servers so the assistant can use their tools.'
              : 'Global search across the school, and connecting LibreChat to this data.'}
        </p>

        <div className="flex flex-wrap gap-1.5 mt-4">
          {([
            { key: 'branding', label: 'Branding', icon: SettingsIcon },
            { key: 'mcp', label: 'MCP Servers', icon: Plug },
            { key: 'integrations', label: 'Search & LibreChat', icon: Search },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        {tab === 'integrations' ? (
          <div className="max-w-3xl">
            <LibreChatPanel />
          </div>
        ) : tab === 'mcp' ? (
          <div className="max-w-3xl">
            <McpServersPanel />
          </div>
        ) : (
        <div className="max-w-2xl space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">School Name</span>
              <input type="text" value={form.school_name} onChange={e => set('school_name')(e.target.value)} placeholder="e.g. Kampala High School" className={inputClass} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Tagline</span>
              <input type="text" value={form.tagline} onChange={e => set('tagline')(e.target.value)} placeholder="e.g. Knowledge is Power" className={inputClass} />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Address</span>
            <input type="text" value={form.address} onChange={e => set('address')(e.target.value)} placeholder="e.g. P.O. Box 123, Kampala, Uganda" className={inputClass} />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Contact Phone</span>
              <input type="text" value={form.contact_phone} onChange={e => set('contact_phone')(e.target.value)} placeholder="+256 ..." className={inputClass} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Contact Email</span>
              <input type="email" value={form.contact_email} onChange={e => set('contact_email')(e.target.value)} placeholder="info@school.ac.ug" className={inputClass} />
            </label>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-indigo-500" /> Academic Level &amp; Grading
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">School level</span>
                <select
                  value={form.school_level}
                  onChange={e => set('school_level')(e.target.value)}
                  className={inputClass}
                >
                  {SCHOOL_LEVEL_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">Examination system</span>
                <select
                  value={form.grading_country}
                  onChange={e => set('grading_country')(e.target.value)}
                  className={inputClass}
                >
                  {GRADING_COUNTRY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* The consequence of the choice, shown before it is saved. */}
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
              <span className="font-medium text-gray-600 dark:text-gray-300">Report cards will grade on: </span>
              {selectedLevel?.grades}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              Set this once — every report card follows it, so nobody has to choose a scale per student. A
              secondary school gets both O-Level and A-Level scales automatically; each student's own class
              decides which applies.
            </p>
          </div>

          <div>
            <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-indigo-500" /> Theme Color
            </span>
            <div className="flex items-center gap-2">
              <input type="color" value={form.theme_color} onChange={e => set('theme_color')(e.target.value)} aria-label="Theme color" className="h-10 w-12 rounded-lg border border-gray-200 dark:border-gray-600 bg-transparent cursor-pointer" />
              <input type="text" value={form.theme_color} onChange={e => set('theme_color')(e.target.value)} placeholder="#2952a3" className={inputClass} />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Used for headings and accents on every generated document.</p>
          </div>

          <div>
            <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">School Logo</span>
            <div className="flex items-center gap-3">
              {form.logo ? (
                <img src={form.logo} alt="School logo" className="w-16 h-16 rounded-lg object-contain border border-gray-200 dark:border-gray-600 bg-white" />
              ) : (
                <div className="w-16 h-16 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-300 dark:text-gray-600">
                  <ImagePlus className="w-6 h-6" />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer w-fit">
                  <ImagePlus className="w-3.5 h-3.5" /> {form.logo ? 'Change' : 'Upload'}
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onLogo} />
                </label>
                {form.logo && (
                  <button type="button" onClick={() => set('logo')('')} className="text-xs text-red-500 hover:underline text-left">Remove</button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium hover:shadow-lg transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
            {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved. Documents now use this branding.</span>}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPanel;
