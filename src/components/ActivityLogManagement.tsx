import React, { useState, useEffect } from 'react';
import { 
  getDriveAccessToken, 
  signInWithGoogleDrive, 
  TARGET_DRIVE_FOLDER_ID, 
  TARGET_DRIVE_FOLDER_URL 
} from '../lib/googleDriveAuth';
import { 
  History, 
  Cloud, 
  Search, 
  Filter, 
  Download, 
  RefreshCw, 
  ExternalLink, 
  CheckCircle2, 
  AlertTriangle, 
  Calendar, 
  User as UserIcon, 
  FileText, 
  Shield, 
  CheckCircle,
  Database,
  ArrowUpFromLine,
  SlidersHorizontal
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  user_role: string | null;
  action: string;
  category: string;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

interface ActivityLogProps {
  token: string;
}

export default function ActivityLogManagement({ token }: ActivityLogProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>({ totalToday: 0, categoriesSummary: [] });
  const [loading, setLoading] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [driveStatus, setDriveStatus] = useState<any>(null);

  useEffect(() => {
    fetchLogs();
    fetchDriveStatus();
  }, [categoryFilter]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter !== 'all') params.append('category', categoryFilter);
      if (searchTerm) params.append('search', searchTerm);
      params.append('limit', '100');

      const res = await fetch(`/api/logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setTotal(data.total || 0);
        setStats(data.stats || { totalToday: 0, categoriesSummary: [] });
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDriveStatus = async () => {
    try {
      const driveToken = getDriveAccessToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (driveToken) headers['x-drive-token'] = driveToken;
      const res = await fetch('/api/drive/status', { headers });
      if (res.ok) {
        setDriveStatus(await res.json());
      }
    } catch (_) {}
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs();
  };

  const handleSyncLogsToDrive = async () => {
    let driveToken = getDriveAccessToken();
    if (!driveToken) {
      try {
        const authResult = await signInWithGoogleDrive();
        if (authResult) driveToken = authResult.accessToken;
      } catch (err: any) {
        setStatusMsg({ text: 'Google Drive authorization required to sync logs: ' + err.message, type: 'error' });
        return;
      }
    }

    if (!driveToken) return;

    setSyncingDrive(true);
    setStatusMsg({ text: 'กำลังซิงค์ไฟล์ Log ทั้งหมด (JSON & CSV) ไปยัง Google Drive...', type: 'info' });

    try {
      const res = await fetch('/api/logs/sync-drive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-drive-token': driveToken,
        },
        body: JSON.stringify({ driveAccessToken: driveToken }),
      });

      const data = await res.json();
      if (res.ok) {
        setStatusMsg({ text: `ซิงค์ Log ไปยัง Google Drive เรียบร้อยแล้ว (${data.count} รายการ)`, type: 'success' });
        fetchDriveStatus();
        fetchLogs();
      } else {
        throw new Error(data.error || 'Failed to sync logs');
      }
    } catch (err: any) {
      console.error('Log sync error:', err);
      setStatusMsg({ text: err.message || 'เกิดข้อผิดพลาดในการซิงค์ Log', type: 'error' });
    } finally {
      setSyncingDrive(false);
    }
  };

  const formatThaiDate = (dateString: string) => {
    if (!dateString) return '-';
    try {
      const normalized = dateString.includes('T') || dateString.includes('Z') || dateString.includes('+')
        ? dateString
        : dateString.replace(' ', 'T') + 'Z';
      const d = new Date(normalized);
      return new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(d);
    } catch {
      return dateString;
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'auth':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200">Auth</span>;
      case 'request':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700 border border-blue-200">Request</span>;
      case 'sample':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 border border-amber-200">Sample/Lab</span>;
      case 'result':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">Result</span>;
      case 'test':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">Test Item</span>;
      case 'user':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700 border border-rose-200">User</span>;
      case 'drive':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-700 border border-sky-200">Google Drive</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">{category}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">Activity Logs & Audit Trail</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              บันทึกกิจกรรมและการเปลี่ยนแปลงทั้งหมด พร้อมบันทึกสำรองลง Google Drive อัตโนมัติ
            </p>
          </div>
        </div>

        {/* Google Drive Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={TARGET_DRIVE_FOLDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors shadow-xs"
          >
            <Cloud className="w-4 h-4 text-blue-500" />
            <span>เปิดโฟลเดอร์ Drive</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>

          <button
            onClick={handleSyncLogsToDrive}
            disabled={syncingDrive}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl transition-all shadow-sm shadow-indigo-100 cursor-pointer"
          >
            <ArrowUpFromLine className={`w-3.5 h-3.5 ${syncingDrive ? 'animate-bounce' : ''}`} />
            <span>{syncingDrive ? 'กำลังซิงค์...' : 'ซิงค์ Log ลง Google Drive'}</span>
          </button>
        </div>
      </div>

      {/* Status banner */}
      {statusMsg && (
        <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
          statusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
          statusMsg.type === 'error' ? 'bg-rose-50 text-rose-800 border border-rose-200' :
          'bg-blue-50 text-blue-800 border border-blue-200'
        }`}>
          {statusMsg.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> :
           statusMsg.type === 'error' ? <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" /> :
           <RefreshCw className="w-4 h-4 text-blue-600 shrink-0 animate-spin" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <History className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">กิจกรรมทั้งหมด</p>
            <p className="text-xl font-bold text-slate-900">{total} รายการ</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">กิจกรรมวันนี้</p>
            <p className="text-xl font-bold text-slate-900">{stats.totalToday || 0} รายการ</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Google Drive Files</p>
            <p className="text-xs font-semibold text-slate-800">dalm_activity_log.json / .csv</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">ดาวน์โหลด Log</p>
            <div className="flex items-center gap-2 mt-1">
              <a
                href={`/api/logs/export?format=csv&token=${token}`}
                download="dalm_activity_logs.csv"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                CSV
              </a>
              <a
                href={`/api/logs/export?format=json&token=${token}`}
                download="dalm_activity_logs.json"
                className="text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                JSON
              </a>
            </div>
          </div>
          <Database className="w-6 h-6 text-slate-300" />
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหาตามผู้ใช้งาน, การกระทำ หรือรายละเอียด..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors cursor-pointer"
          >
            ค้นหา
          </button>
        </form>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="all">ทุกหมวดหมู่ (All Categories)</option>
            <option value="auth">Auth / เข้าสู่ระบบ</option>
            <option value="request">Request / คำขอตรวจ</option>
            <option value="sample">Sample / ตรวจรับแล็บ</option>
            <option value="result">Result / ผลแล็บ</option>
            <option value="test">Test / รายการทดสอบ</option>
            <option value="user">User / ผู้ใช้งาน</option>
            <option value="drive">Drive / สำรอง Google Drive</option>
            <option value="settings">Settings / ตั้งค่าระบบ</option>
          </select>

          <button
            onClick={() => { setSearchTerm(''); setCategoryFilter('all'); fetchLogs(); }}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">วัน-เวลา (Timestamp)</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">ผู้ใช้งาน (User)</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">หมวดหมู่ (Category)</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">กิจกรรม (Activity Action)</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">รายละเอียด (Details)</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 text-xs">
                    {loading ? 'กำลังโหลดข้อมูล...' : 'ไม่พบประวัติกิจกรรมตามเงื่อนไขที่เลือก'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-xs font-medium text-slate-600 whitespace-nowrap">
                      {formatThaiDate(log.created_at)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-bold">
                          {(log.username || 'U')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-800">{log.username || '-'}</p>
                          {log.user_role && (
                            <span className="text-[10px] text-slate-400 capitalize">{log.user_role}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {getCategoryBadge(log.category)}
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-xs font-medium text-slate-900 leading-snug">{log.action}</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500 max-w-xs truncate">
                      {log.details ? (
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline text-left truncate block max-w-xs cursor-pointer font-mono"
                          title="คลิกเพื่อดูรายละเอียดฉบับเต็ม"
                        >
                          {log.details}
                        </button>
                      ) : (
                        <span className="text-slate-300 italic">-</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-slate-400 whitespace-nowrap">
                      {log.ip_address || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h4 className="text-sm font-bold text-slate-900">รายละเอียด Log #{selectedLog.id}</h4>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 font-medium">วัน-เวลา:</span>
                <p className="font-semibold text-slate-800">{formatThaiDate(selectedLog.created_at)}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">ผู้ใช้งาน:</span>
                <p className="font-semibold text-slate-800">{selectedLog.username} ({selectedLog.user_role})</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">กิจกรรม:</span>
                <p className="font-semibold text-slate-800">{selectedLog.action}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">รายละเอียดข้อมูล JSON:</span>
                <pre className="mt-1 p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono text-[11px] text-slate-800 overflow-x-auto whitespace-pre-wrap max-h-60">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(selectedLog.details || '{}'), null, 2);
                    } catch {
                      return selectedLog.details || '-';
                    }
                  })()}
                </pre>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
