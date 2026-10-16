import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Bell, LogOut, Plus, FileText, Upload, CheckCircle, Clock, Activity, Search, PackageCheck, Pencil, Trash2, Download, Printer, Languages, Users, Settings, ChevronDown, LayoutDashboard, User, History, Cloud, ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useTranslation } from 'react-i18next';
import GoogleDrivePersistence from '../components/GoogleDrivePersistence';
import ActivityLogManagement from '../components/ActivityLogManagement';
import { triggerAutoDriveSync, getDriveAccessToken, signInWithGoogleDrive, initDriveAuth } from '../lib/googleDriveAuth';

interface Request {
  id: number;
  sample_name: string;
  case_name?: string;
  lot_number: string;
  tube_count: number;
  is_initial: boolean;
  is_in_process: boolean;
  is_finish_product: boolean;
  status: string;
  created_at: string;
  received_at?: string;
  test_count: number;
  requester_name?: string;
  result_file?: string;
  drive_file_id?: string;
  drive_web_link?: string;
  lab_number?: string;
  test_codes?: string;
  processing_day?: number;
}

interface Notification {
  id: number;
  message: string;
  created_at: string;
  is_read: number;
}

// Helper for Thai Timezone
const formatThaiDate = (dateString: string, timeOnly = false) => {
  if (!dateString) return '-';
  
  // Normalize date string for consistent parsing
  // SQLite CURRENT_TIMESTAMP returns 'YYYY-MM-DD HH:MM:SS'
  // We want to ensure it's treated as UTC if no timezone is present
  const normalized = dateString.includes('T') || dateString.includes('Z') || dateString.includes('+')
    ? dateString
    : dateString.replace(' ', 'T') + 'Z';
    
  const date = new Date(normalized);
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  
  if (!timeOnly) {
    options.day = 'numeric';
    options.month = 'short';
    options.year = '2-digit';
  }

  return new Intl.DateTimeFormat('th-TH', options).format(date);
};

const getTestCodeColor = (code: string) => {
  const colors: Record<string, string> = {
    'CB': 'bg-red-100 text-red-700 border-red-200',
    'GL': 'bg-blue-100 text-blue-700 border-blue-200',
    'UA': 'bg-amber-100 text-amber-700 border-amber-200',
    'HE': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'CH': 'bg-purple-100 text-purple-700 border-purple-200',
    'BC': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'CR': 'bg-rose-100 text-rose-700 border-rose-200',
    'BU': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    'ST': 'bg-violet-100 text-violet-700 border-violet-200',
    'ID': 'bg-orange-100 text-orange-700 border-orange-200',
    'VI': 'bg-lime-100 text-lime-700 border-lime-200',
    'PO': 'bg-pink-100 text-pink-700 border-pink-200',
    'IM': 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
    'PU': 'bg-sky-100 text-sky-700 border-sky-200',
    'MY': 'bg-teal-100 text-teal-700 border-teal-200',
    'EM': 'bg-slate-200 text-slate-700 border-slate-300',
    'AP': 'bg-yellow-100 text-yellow-700 border-yellow-200',
    'PH': 'bg-rose-50 text-rose-600 border-rose-100',
    'OS': 'bg-sky-50 text-sky-600 border-sky-100',
  };
  
  const shortCode = code.substring(0, 2).toUpperCase();
  return colors[shortCode] || 'bg-slate-100 text-slate-700 border-slate-200';
};

export default function DashboardPage() {
  const { user, token, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const [requests, setRequests] = useState<Request[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'received' | 'completed' | 'tests' | 'users' | 'logs' | 'settings'>('all');
  const [showNewTestModal, setShowNewTestModal] = useState(false);
  const [receivingRequest, setReceivingRequest] = useState<Request | null>(null);
  const [settings, setSettings] = useState({ app_name: 'LabFlow', app_logo: '' });

  const [editingRequest, setEditingRequest] = useState<Request | null>(null);

  const [startupSyncNotice, setStartupSyncNotice] = useState<{ status: 'syncing' | 'success' | 'info'; text: string } | null>(null);
  const autoSyncedRef = React.useRef(false);

  // Auto-Sync on App Open: Check and restore latest database from Google Drive
  const handleAutoSyncOnOpen = async (driveAccessToken: string) => {
    if (autoSyncedRef.current || !token) return;
    autoSyncedRef.current = true;

    try {
      setStartupSyncNotice({ status: 'syncing', text: 'กำลังตรวจสอบและซิงค์ข้อมูลล่าสุดจาก Google Drive...' });
      const res = await fetch('/api/drive/auto-sync-open', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-drive-token': driveAccessToken,
        },
        body: JSON.stringify({ driveAccessToken }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.action === 'restored_from_drive') {
          fetchRequests();
          fetchNotifications();
          fetchSettings();
          setStartupSyncNotice({
            status: 'success',
            text: `ซิงค์ข้อมูลล่าสุดจาก Google Drive เรียบร้อยแล้ว (${data.stats?.requests || 0} คำขอตรวจ)`
          });
          setTimeout(() => setStartupSyncNotice(null), 6000);
        } else if (data.action === 'synced_to_drive') {
          setStartupSyncNotice({
            status: 'success',
            text: 'สำรองฐานข้อมูลขึ้น Google Drive เรียบร้อยแล้ว'
          });
          setTimeout(() => setStartupSyncNotice(null), 5000);
        } else {
          setStartupSyncNotice({
            status: 'info',
            text: 'ข้อมูลเป็นปัจจุบันตรงกับ Google Drive แล้ว'
          });
          setTimeout(() => setStartupSyncNotice(null), 4000);
        }
      } else {
        setStartupSyncNotice(null);
      }
    } catch (e) {
      console.warn('[Auto-Sync-On-Open] Failed:', e);
      setStartupSyncNotice(null);
    }
  };

  useEffect(() => {
    fetchRequests();
    fetchNotifications();
    fetchSettings();

    // Check if Drive token is already available or when auth initializes
    const existingToken = getDriveAccessToken();
    if (existingToken) {
      handleAutoSyncOnOpen(existingToken);
    }

    const unsubscribe = initDriveAuth((_user, driveToken) => {
      if (driveToken) {
        handleAutoSyncOnOpen(driveToken);
      }
    });

    // Poll for updates every 30 seconds
    const interval = setInterval(() => {
      fetchRequests();
      fetchNotifications();
    }, 30000);

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [token]);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) setSettings(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/requests', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setRequests(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const [requestToDelete, setRequestToDelete] = useState<number | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const handleDeleteClick = (id: number) => {
    setRequestToDelete(id);
    setDeletePassword('');
    setDeleteError('');
  };

  const confirmDelete = async () => {
    if (!requestToDelete) return;
    if (!deletePassword) {
      alert('Please enter your password to confirm deletion');
      return;
    }
    
    try {
      const res = await fetch(`/api/requests/${requestToDelete}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ password: deletePassword })
      });
      if (res.ok) {
        fetchRequests();
        triggerAutoDriveSync(token!);
        setRequestToDelete(null);
        setDeletePassword('');
        setDeleteError('');
      } else {
        const data = await res.json();
        if (data.error === 'Invalid password') {
          setDeleteError('รหัสผิด');
        } else {
          setDeleteError(data.error || 'Failed to delete request');
        }
      }
    } catch (err) {
      console.error(err);
      setDeleteError('Network error');
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setNotifications(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const markNotificationsAsRead = async () => {
    if (notifications.some(n => !n.is_read)) {
      try {
        await fetch('/api/notifications/read', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` }
        });
        fetchNotifications();
      } catch (err) {
        console.error(err);
      }
    }
  };

  const filteredRequests = requests.filter(r => {
    if (activeTab === 'all') return true;
    return r.status === activeTab;
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-600 p-2 rounded-lg overflow-hidden flex items-center justify-center w-9 h-9">
                {settings.app_logo ? (
                  <img src={settings.app_logo} alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                ) : (
                  <Activity className="w-5 h-5 text-white" />
                )}
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{settings.app_name}</h1>
                <p className="text-xs text-slate-500 font-medium">{user?.role.toUpperCase()} VIEW</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Language Switcher */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                <button 
                  onClick={() => i18n.changeLanguage('en')}
                  className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${i18n.language === 'en' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  EN
                </button>
                <button 
                  onClick={() => i18n.changeLanguage('th')}
                  className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${i18n.language === 'th' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  TH
                </button>
              </div>

              {/* Google Drive Persistence Status Badge */}
              <GoogleDrivePersistence token={token!} compact onRefreshData={fetchRequests} />

              <div className="relative group" onMouseEnter={markNotificationsAsRead}>
                <button className="p-2 text-slate-400 hover:text-slate-600 relative">
                  <Bell className="w-6 h-6" />
                  {notifications.some(n => !n.is_read) && (
                    <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                  )}
                </button>
                {/* Notification Dropdown */}
                <div className="absolute right-0 top-full pt-2 w-80 hidden group-hover:block z-20">
                  <div className="bg-white rounded-xl shadow-lg border border-slate-100 p-2">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">Notifications</h3>
                    {notifications.length === 0 ? (
                      <p className="text-sm text-slate-500 px-3 py-2">No new notifications</p>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} className={`px-3 py-2 hover:bg-slate-50 rounded-lg relative ${!n.is_read ? 'bg-indigo-50/30' : ''}`}>
                          {!n.is_read && <span className="absolute left-1 top-4 w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>}
                          <p className={`text-sm ${!n.is_read ? 'text-slate-900 font-semibold' : 'text-slate-700'}`}>{n.message}</p>
                          <p className="text-xs text-slate-400 mt-1">{formatThaiDate(n.created_at)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="relative group">
                <button className="flex items-center gap-3 pl-4 border-l border-slate-200 hover:bg-slate-50 py-1 px-2 transition-colors rounded-lg">
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-medium text-slate-900">{user?.name}</p>
                    <p className="text-xs text-slate-500">{user?.username}</p>
                  </div>
                  <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-500">
                    <User className="w-4 h-4" />
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400 group-hover:rotate-180 transition-transform" />
                </button>
                
                <div className="absolute right-0 top-full pt-2 w-56 hidden group-hover:block z-20">
                  <div className="bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden">
                    <div className="p-2 border-b border-slate-50 bg-slate-50/50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase px-3 py-1">{t('users.role')}: {t(`users.roles.${user?.role}`)}</p>
                    </div>
                    
                    <div className="p-1">
                      <button 
                        onClick={() => setActiveTab('all')}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'all' || activeTab === 'pending' || activeTab === 'received' || activeTab === 'completed' ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <LayoutDashboard className="w-4 h-4" />
                        {t('menu.dashboard')}
                      </button>
                      <div className="my-1 border-t border-slate-100" />
                      {user?.role === 'admin' && (
                        <>
                          <button 
                            onClick={() => setActiveTab('tests')}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'tests' ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                          >
                            <Activity className="w-4 h-4" />
                            {t('menu.tests')}
                          </button>
                          <button 
                            onClick={() => setActiveTab('users')}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'users' ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                          >
                            <Users className="w-4 h-4" />
                            {t('menu.users')}
                          </button>
                          <button 
                            onClick={() => setActiveTab('logs')}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'logs' ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                          >
                            <History className="w-4 h-4" />
                            {t('menu.logs')}
                          </button>
                          <button 
                            onClick={() => setActiveTab('settings')}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'settings' ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                          >
                            <Settings className="w-4 h-4" />
                            {t('menu.settings')}
                          </button>
                          <div className="my-1 border-t border-slate-100" />
                        </>
                      )}
                      
                      <button 
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        {t('menu.logout')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Startup Auto-Sync Notice Banner */}
        {startupSyncNotice && (
          <motion.div 
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mb-6 p-3.5 rounded-2xl flex items-center justify-between gap-3 text-xs font-semibold shadow-xs transition-all ${
              startupSyncNotice.status === 'syncing' ? 'bg-blue-50 text-blue-800 border border-blue-200' :
              startupSyncNotice.status === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
              'bg-indigo-50 text-indigo-800 border border-indigo-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Cloud className={`w-4 h-4 ${startupSyncNotice.status === 'syncing' ? 'animate-bounce text-blue-600' : 'text-emerald-600'}`} />
              <span>{startupSyncNotice.text}</span>
            </div>
            <button 
              onClick={() => setStartupSyncNotice(null)} 
              className="text-slate-400 hover:text-slate-600 px-1 py-0.5 rounded cursor-pointer"
            >
              ✕
            </button>
          </motion.div>
        )}

        {/* Header & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{t('dashboard.title')}</h2>
            <p className="text-slate-500">{t('dashboard.welcome')}, {user?.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {(user?.role === 'lab_tech' || user?.role === 'admin') && (
              <button 
                onClick={() => setShowReportModal(true)}
                className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2.5 rounded-xl font-medium shadow-sm transition-all"
              >
                <FileText className="w-5 h-5 text-indigo-600" />
                {t('menu.reports')}
              </button>
            )}
            {(user?.role === 'requester' || user?.role === 'admin') && (
              <button 
                onClick={() => setShowNewRequestModal(true)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium shadow-sm shadow-indigo-200 transition-all"
              >
                <Plus className="w-5 h-5" />
                {t('samples.add')}
              </button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div 
            onClick={() => setActiveTab('all')}
            className={`p-6 rounded-2xl shadow-sm border transition-all cursor-pointer hover:shadow-md ${
              activeTab === 'all' ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-100' : 'bg-white border-slate-100 hover:border-blue-200'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className="bg-blue-100 p-3 rounded-xl">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">{t('dashboard.stats.total')}</p>
                <p className="text-2xl font-bold text-slate-900">{requests.length}</p>
              </div>
            </div>
          </div>
          <div 
            onClick={() => setActiveTab('pending')}
            className={`p-6 rounded-2xl shadow-sm border transition-all cursor-pointer hover:shadow-md ${
              activeTab === 'pending' ? 'bg-amber-50 border-amber-200 ring-2 ring-amber-100' : 'bg-white border-slate-100 hover:border-amber-200'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className="bg-amber-100 p-3 rounded-xl">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">{t('dashboard.stats.pending')}</p>
                <p className="text-2xl font-bold text-slate-900">{requests.filter(r => r.status === 'pending').length}</p>
              </div>
            </div>
          </div>
          <div 
            onClick={() => setActiveTab('received')}
            className={`p-6 rounded-2xl shadow-sm border transition-all cursor-pointer hover:shadow-md ${
              activeTab === 'received' ? 'bg-indigo-50 border-indigo-200 ring-2 ring-indigo-100' : 'bg-white border-slate-100 hover:border-indigo-200'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className="bg-indigo-100 p-3 rounded-xl">
                <PackageCheck className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">{t('dashboard.stats.inProgress')}</p>
                <p className="text-2xl font-bold text-slate-900">{requests.filter(r => r.status === 'received').length}</p>
              </div>
            </div>
          </div>
          <div 
            onClick={() => setActiveTab('completed')}
            className={`p-6 rounded-2xl shadow-sm border transition-all cursor-pointer hover:shadow-md ${
              activeTab === 'completed' ? 'bg-emerald-50 border-emerald-200 ring-2 ring-emerald-100' : 'bg-white border-slate-100 hover:border-emerald-200'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className="bg-emerald-100 p-3 rounded-xl">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">{t('dashboard.stats.completed')}</p>
                <p className="text-2xl font-bold text-slate-900">{requests.filter(r => r.status === 'completed').length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          {['all', 'pending', 'received', 'completed'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                activeTab === tab 
                  ? 'bg-slate-900 text-white' 
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              {tab === 'all' ? t('menu.dashboard') : t(`dashboard.stats.${tab === 'received' ? 'inProgress' : tab}`)}
            </button>
          ))}
        </div>

        {/* Content Area */}
        {activeTab === 'tests' ? (
          <TestManagement token={token!} />
        ) : activeTab === 'users' ? (
          <UserManagement token={token!} />
        ) : activeTab === 'logs' ? (
          <ActivityLogManagement token={token!} />
        ) : activeTab === 'settings' ? (
          <SettingsManagement token={token!} onUpdate={fetchSettings} currentSettings={settings} />
        ) : (
          /* Requests List */
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.table.labNumber')} / {t('dashboard.table.lotNumber')}</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.table.tubes')}</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.table.day')}</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.table.tests')}</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.table.status')}</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.table.createdAt')}</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.table.receivedAt')}</th>
                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2">
                        <div className="flex flex-col gap-0.5">
                          {(req.test_codes?.split(',') || []).map((code, idx) => (
                            <span 
                              key={idx} 
                              className={`px-1 py-0.5 rounded text-[10px] font-bold border text-center min-w-[24px] ${getTestCodeColor(code)}`}
                              title={code}
                            >
                              {code.substring(0, 2).toUpperCase()}
                            </span>
                          ))}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{req.sample_name}</p>
                          {req.requester_name && <p className="text-[10px] text-slate-400 italic">By: {req.requester_name}</p>}
                          {req.case_name && <p className="text-xs text-indigo-600 font-medium">{req.case_name}</p>}
                          <p className="text-xs text-slate-500">{t('dashboard.table.lotNumber')}: {req.lot_number}</p>
                          {req.lab_number && (
                            <p className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 w-fit mt-1">
                              {t('dashboard.table.labNumber')}: {req.lab_number}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {!!req.is_initial && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded border border-blue-100">IN</span>}
                            {!!req.is_in_process && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[10px] font-bold rounded border border-amber-100">IP</span>}
                            {!!req.is_finish_product && <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded border border-emerald-100">FP</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{req.tube_count || 1}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-medium">{req.processing_day ?? 0}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{req.test_count} {t('dashboard.table.items')}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        req.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                        req.status === 'received' ? 'bg-indigo-100 text-indigo-800' :
                        req.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {t(`dashboard.table.statuses.${req.status}`)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 font-medium">
                      {formatThaiDate(req.created_at)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {req.received_at ? (
                        <span className="text-indigo-600 font-medium">
                          {formatThaiDate(req.received_at)}
                        </span>
                      ) : (
                        <span className="text-slate-300 italic">Pending</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <RequestActionButtons 
                        request={req} 
                        userRole={user?.role} 
                        onUpdate={fetchRequests} 
                        token={token!} 
                        onEdit={(r) => { setEditingRequest(r); setShowNewRequestModal(true); }}
                        onDelete={handleDeleteClick}
                        onReceive={(r) => setReceivingRequest(r)}
                      />
                    </td>
                  </tr>
                ))}
                {filteredRequests.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      No requests found matching your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </main>

      {/* New/Edit Request Modal */}
      {showNewRequestModal && (
        <NewRequestModal 
          onClose={() => { setShowNewRequestModal(false); setEditingRequest(null); }} 
          onSuccess={() => { 
            setShowNewRequestModal(false); 
            setEditingRequest(null); 
            fetchRequests(); 
            triggerAutoDriveSync(token!); 
          }} 
          token={token!}
          initialData={editingRequest || undefined}
        />
      )}

      {showReportModal && (
        <ReportModal 
          requests={requests}
          onClose={() => setShowReportModal(false)}
        />
      )}

      {receivingRequest && (
        <ReceiveModal 
          request={receivingRequest}
          onClose={() => setReceivingRequest(null)}
          onSuccess={() => { 
            setReceivingRequest(null); 
            fetchRequests(); 
            triggerAutoDriveSync(token!); 
          }}
          token={token!}
        />
      )}

      {/* Delete Confirmation Modal */}
      {requestToDelete !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden p-6"
          >
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <div className="bg-red-100 p-2 rounded-full">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">{t('modals.delete.title')}</h3>
            </div>
            <p className="text-slate-600 mb-4">
              {t('modals.delete.message')}
            </p>
            
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('users.password')}
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => {
                  setDeletePassword(e.target.value);
                  if (deleteError) setDeleteError('');
                }}
                className={`w-full px-3 py-2 border rounded-lg outline-none transition-all ${
                  deleteError 
                    ? 'border-red-500 ring-2 ring-red-500/20' 
                    : 'border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500'
                }`}
                placeholder={t('login.passwordPlaceholder')}
                autoFocus
              />
              {deleteError && (
                <p className="text-red-600 text-sm mt-2 animate-pulse font-medium">
                  {deleteError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => { setRequestToDelete(null); setDeletePassword(''); }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg font-medium"
              >
                {t('common.cancel')}
              </button>
              <button 
                onClick={confirmDelete}
                disabled={!deletePassword}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed text-white rounded-lg font-medium shadow-sm transition-colors"
              >
                {t('common.delete')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function RequestActionButtons({ request, userRole, onUpdate, token, onEdit, onDelete, onReceive }: { request: Request, userRole: any, onUpdate: () => void, token: string, onEdit: (r: Request) => void, onDelete: (id: number) => void, onReceive: (r: Request) => void }) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [syncingToDrive, setSyncingToDrive] = useState(false);

  const handleReceiveSample = async () => {
    onReceive(request);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', e.target.files[0]);

    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const driveToken = getDriveAccessToken();
      if (driveToken) {
        headers['x-drive-token'] = driveToken;
      }

      const res = await fetch(`/api/requests/${request.id}/result`, {
        method: 'POST',
        headers,
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        onUpdate();
        triggerAutoDriveSync(token);
        if (data.driveUploaded) {
          alert('อัปโหลดผลแล็บและบันทึกลงใน Google Drive สำเร็จเรียบร้อย!');
        } else {
          alert('Result uploaded successfully!');
        }
      } else {
        alert(`Upload failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(err);
      alert('Upload failed due to network error');
    } finally {
      setUploading(false);
    }
  };

  const handleManualSyncDriveResult = async () => {
    let driveToken = getDriveAccessToken();
    if (!driveToken) {
      try {
        const auth = await signInWithGoogleDrive();
        if (auth) driveToken = auth.accessToken;
      } catch (e: any) {
        alert('Google Drive authorization required: ' + e.message);
        return;
      }
    }
    if (!driveToken) return;

    setSyncingToDrive(true);
    try {
      const res = await fetch(`/api/requests/${request.id}/sync-drive-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-drive-token': driveToken
        }
      });
      const data = await res.json();
      if (res.ok) {
        onUpdate();
        alert('บันทึกไฟล์ผลแล็บลง Google Drive เรียบร้อยแล้ว!');
      } else {
        alert(data.error || 'Failed to sync result to Google Drive');
      }
    } catch (e) {
      alert('Failed to sync to Google Drive');
    } finally {
      setSyncingToDrive(false);
    }
  };

  const renderStatusAction = () => {
    if (request.status === 'completed') {
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <a 
            href={request.result_file ? `/api/results/${request.result_file}?token=${token}` : '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!request.result_file) {
                e.preventDefault();
                alert('File not found');
              }
            }}
            className="text-indigo-600 hover:text-indigo-900 text-xs font-semibold flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg border border-indigo-200 transition-colors"
            title="Download / View Local Result PDF"
          >
            <FileText className="w-3.5 h-3.5" /> <span>View Result</span>
          </a>

          {request.drive_web_link ? (
            <a 
              href={request.drive_web_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 px-2 py-1.5 rounded-lg border border-emerald-200 transition-colors"
              title="Open file in Google Drive"
            >
              <Cloud className="w-3.5 h-3.5 text-emerald-600" />
              <span>Drive</span>
              <ExternalLink className="w-3 h-3 text-emerald-600" />
            </a>
          ) : (userRole === 'lab_tech' || userRole === 'admin') ? (
            <button
              onClick={handleManualSyncDriveResult}
              disabled={syncingToDrive}
              className="text-slate-600 hover:text-indigo-700 text-[11px] font-medium flex items-center gap-1 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 rounded-lg border border-slate-200 transition-colors cursor-pointer"
              title="Save this result file to Google Drive"
            >
              <Cloud className={`w-3 h-3 ${syncingToDrive ? 'animate-bounce text-indigo-600' : 'text-slate-500'}`} />
              <span>{syncingToDrive ? 'Syncing...' : 'Save to Drive'}</span>
            </button>
          ) : null}
        </div>
      );
    }

    if (userRole === 'lab_tech' || userRole === 'admin') {
      if (request.status === 'pending') {
        return (
          <button 
            onClick={handleReceiveSample}
            disabled={processing}
            className={`flex items-center gap-1 text-amber-600 hover:text-amber-800 text-sm font-medium bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg transition-colors ${processing ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <PackageCheck className={`w-4 h-4 ${processing ? 'animate-pulse' : ''}`} /> 
            {processing ? 'Receiving...' : 'Receive Sample'}
          </button>
        );
      }

      if (request.status === 'received') {
        return (
          <div className="flex items-center gap-2">
            <label className="cursor-pointer flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-sm font-medium bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors">
              <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              <Upload className={`w-4 h-4 ${uploading ? 'animate-pulse' : ''}`} />
              {uploading ? 'Uploading...' : 'Upload Result'}
            </label>
          </div>
        );
      }
    }

    return <span className="text-slate-400 text-sm">{request.status === 'pending' ? 'Waiting for Lab' : 'Processing'}</span>;
  };

  return (
    <div className="flex items-center gap-3">
      {renderStatusAction()}
      {userRole === 'admin' && (
        <div className="flex items-center gap-1 border-l border-slate-200 pl-3 ml-2">
          <button 
            onClick={() => onEdit(request)} 
            className="p-1 text-slate-400 hover:text-indigo-600 transition-colors" 
            title={t('common.edit')}
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onDelete(request.id);
            }} 
            className="p-1 text-slate-400 hover:text-red-600 transition-colors" 
            title={t('common.delete')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function ReceiveModal({ request, onClose, onSuccess, token }: { request: Request, onClose: () => void, onSuccess: () => void, token: string }) {
  const { t } = useTranslation();
  const [labNumber, setLabNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/requests/${request.id}/suggest-lab-number`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      setLabNumber(data.suggested);
      setLoading(false);
    })
    .catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [request.id, token]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/requests/${request.id}/receive`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ lab_number: labNumber })
      });
      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to receive sample');
      }
    } catch (err) {
      alert('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4 text-amber-600">
            <div className="bg-amber-100 p-2 rounded-full">
              <PackageCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Receive Sample</h3>
          </div>
          
          <p className="text-slate-600 mb-4 text-sm">
            Generate and confirm the Lab Number for this sample. You can edit it if needed.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Sample Name
              </label>
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium">
                {request.sample_name}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Lab Number
              </label>
              <input 
                type="text"
                value={labNumber}
                onChange={e => setLabNumber(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                placeholder={loading ? 'Generating...' : 'QC...'}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-8">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button 
              onClick={handleConfirm}
              disabled={loading || submitting || !labNumber}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg font-medium shadow-sm transition-colors flex items-center gap-2"
            >
              {submitting ? 'Confirming...' : 'Confirm Receive'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function NewRequestModal({ onClose, onSuccess, token, initialData }: { onClose: () => void, onSuccess: () => void, token: string, initialData?: Request }) {
  const { t } = useTranslation();
  const [tests, setTests] = useState<any[]>([]);
  const [selectedTests, setSelectedTests] = useState<number[]>([]);
  const [sampleName, setSampleName] = useState(initialData?.sample_name || '');
  const [caseName, setCaseName] = useState(initialData?.case_name || '');
  const [lotNumber, setLotNumber] = useState(initialData?.lot_number || '');
  const [tubeCount, setTubeCount] = useState(initialData?.tube_count || 1);
  const [isInitial, setIsInitial] = useState(!!initialData?.is_initial);
  const [isInProcess, setIsInProcess] = useState(!!initialData?.is_in_process);
  const [isFinishProduct, setIsFinishProduct] = useState(!!initialData?.is_finish_product);
  const [processingDay, setProcessingDay] = useState(initialData?.processing_day || 0);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [activeSearchField, setActiveSearchField] = useState<'lot' | 'case' | 'sample' | null>(null);

  useEffect(() => {
    fetch('/api/tests', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setTests);
      
    if (initialData) {
      fetch(`/api/requests/${initialData.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data.items) {
            setSelectedTests(data.items.map((i: any) => i.id));
          }
        })
        .catch(console.error);
    }
  }, [token, initialData]);

  const handleSearch = async (query: string, field: 'lot' | 'case' | 'sample') => {
    if (field === 'lot') setLotNumber(query);
    else if (field === 'case') setCaseName(query);
    else setSampleName(query);
    
    setActiveSearchField(field);

    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const res = await fetch(`/api/patients/search?q=${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const selectPatient = (patient: any) => {
    setLotNumber(patient.lot_number);
    setCaseName(patient.case_name || '');
    setSampleName(patient.sample_name || '');
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = initialData ? `/api/requests/${initialData.id}` : '/api/requests';
      const method = initialData ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method: method,
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          sample_name: sampleName,
          case_name: caseName,
          lot_number: lotNumber,
          tube_count: tubeCount,
          test_item_ids: selectedTests,
          is_initial: isInitial,
          is_in_process: isInProcess,
          is_finish_product: isFinishProduct,
          processing_day: processingDay
        })
      });
      if (res.ok) onSuccess();
      else {
        const data = await res.json();
        alert(data.error || 'Failed to save request');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-900">{initialData ? t('common.edit') : t('samples.add')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <LogOut className="w-5 h-5 rotate-45" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('samples.table.patient')}</label>
              <div className="relative">
                <input 
                  required
                  value={sampleName}
                  onChange={e => handleSearch(e.target.value, 'sample')}
                  onFocus={() => {
                    setActiveSearchField('sample');
                    if (sampleName.length >= 2) setShowSuggestions(true);
                  }}
                  className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder={t('samples.table.id')}
                />
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
              {showSuggestions && activeSearchField === 'sample' && (
                <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {suggestions.map((s, i) => (
                    <div 
                      key={i} 
                      onClick={() => selectPatient(s)}
                      className="px-3 py-2 hover:bg-indigo-50 cursor-pointer text-sm"
                    >
                      <p className="font-medium text-slate-900">{s.sample_name}</p>
                      <p className="text-xs text-slate-500">{s.lot_number} - {s.case_name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('dashboard.table.lotNumber')}</label>
              <div className="relative">
                <input 
                  required
                  value={lotNumber}
                  onChange={e => handleSearch(e.target.value, 'lot')}
                  onFocus={() => {
                    setActiveSearchField('lot');
                    if (lotNumber.length >= 2) setShowSuggestions(true);
                  }}
                  className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder={t('common.search')}
                />
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
              {showSuggestions && activeSearchField === 'lot' && (
                <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {suggestions.map((s, i) => (
                    <div 
                      key={i} 
                      onClick={() => selectPatient(s)}
                      className="px-3 py-2 hover:bg-indigo-50 cursor-pointer text-sm"
                    >
                      <p className="font-medium text-slate-900">{s.lot_number}</p>
                      <p className="text-xs text-slate-500">{s.case_name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('dashboard.table.caseName')}</label>
            <div className="relative">
              <input 
                value={caseName}
                onChange={e => handleSearch(e.target.value, 'case')}
                onFocus={() => {
                  setActiveSearchField('case');
                  if (caseName.length >= 2) setShowSuggestions(true);
                }}
                className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="e.g. John Doe, Case #123"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            {showSuggestions && activeSearchField === 'case' && (
              <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <div 
                    key={i} 
                    onClick={() => selectPatient(s)}
                    className="px-3 py-2 hover:bg-indigo-50 cursor-pointer text-sm"
                  >
                    <p className="font-medium text-slate-900">{s.case_name}</p>
                    <p className="text-xs text-slate-500">{s.lot_number}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('dashboard.table.tubes')}</label>
              <input 
                type="number"
                min="1"
                required
                value={tubeCount}
                onChange={e => setTubeCount(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('dashboard.table.day')}</label>
              <select 
                value={processingDay}
                onChange={e => setProcessingDay(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                {Array.from({ length: 21 }, (_, i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <label className="block text-sm font-medium text-slate-700 mb-2">{t('modals.receive.sampleType')}</label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={isInitial}
                  onChange={e => setIsInitial(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 mr-2"
                />
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 transition-colors">{t('dashboard.table.stages.initial')}</span>
              </label>
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={isInProcess}
                  onChange={e => setIsInProcess(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 mr-2"
                />
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 transition-colors">{t('dashboard.table.stages.inProcess')}</span>
              </label>
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={isFinishProduct}
                  onChange={e => setIsFinishProduct(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 mr-2"
                />
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 transition-colors">{t('dashboard.table.stages.finishProduct')}</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{t('modals.receive.selectTests')}</label>
            <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
              {tests.map(test => (
                <label key={test.id} className="flex items-center p-3 hover:bg-slate-50 cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="rounded text-indigo-600 focus:ring-indigo-500 mr-3"
                    checked={selectedTests.includes(test.id)}
                    onChange={e => {
                      if (e.target.checked) setSelectedTests([...selectedTests, test.id]);
                      else setSelectedTests(selectedTests.filter(id => id !== test.id));
                    }}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">{test.name}</p>
                    <p className="text-xs text-slate-500">{test.code} - ${test.price}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg font-medium">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm">
              {initialData ? t('common.save') : t('samples.add')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function UserManagement({ token }: { token: string }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'requester', name: '' });

  const fetchUsers = async () => {
    const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setUsers(await res.json());
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newUser)
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewUser({ username: '', password: '', role: 'requester', name: '' });
        fetchUsers();
        triggerAutoDriveSync(token);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to create user');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    
    try {
      const payload: any = { role: editingUser.role, name: editingUser.name };
      if (editingUser.password) payload.password = editingUser.password;

      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        setShowEditModal(false);
        setEditingUser(null);
        fetchUsers();
        triggerAutoDriveSync(token);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update user');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchUsers();
        triggerAutoDriveSync(token);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete user');
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-slate-900">{t('users.title')}</h3>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {t('users.add')}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('users.name')}</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('users.username')}</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('users.role')}</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('users.createdAt')}</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-900">{u.name}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{u.username}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                    u.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                    u.role === 'lab_tech' ? 'bg-blue-100 text-blue-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {t(`users.roles.${u.role}`)}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">{formatThaiDate(u.created_at)}</td>
                <td className="px-6 py-4 text-sm">
                  <button 
                    onClick={() => { setEditingUser({...u, password: ''}); setShowEditModal(true); }}
                    className="text-indigo-600 hover:text-indigo-900 mr-3"
                  >
                    {t('common.edit')}
                  </button>
                  <button 
                    onClick={() => handleDeleteUser(u.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    {t('common.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">{t('users.add')}</h3>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('users.name')}</label>
                <input 
                  className="w-full px-3 py-2 border rounded-lg"
                  value={newUser.name}
                  onChange={e => setNewUser({...newUser, name: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('users.username')}</label>
                <input 
                  className="w-full px-3 py-2 border rounded-lg"
                  value={newUser.username}
                  onChange={e => setNewUser({...newUser, username: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('users.password')}</label>
                <input 
                  type="password"
                  className="w-full px-3 py-2 border rounded-lg"
                  value={newUser.password}
                  onChange={e => setNewUser({...newUser, password: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('users.role')}</label>
                <select 
                  className="w-full px-3 py-2 border rounded-lg"
                  value={newUser.role}
                  onChange={e => setNewUser({...newUser, role: e.target.value})}
                >
                  <option value="requester">{t('users.roles.requester')}</option>
                  <option value="lab_tech">{t('users.roles.lab_tech')}</option>
                  <option value="admin">{t('users.roles.admin')}</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-slate-600">{t('common.cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg">{t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-md p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">{t('users.edit')}: {editingUser.username}</h3>
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('users.name')}</label>
                <input 
                  className="w-full px-3 py-2 border rounded-lg"
                  value={editingUser.name}
                  onChange={e => setEditingUser({...editingUser, name: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('users.password')} ({t('users.leaveBlank')})</label>
                <input 
                  type="password"
                  className="w-full px-3 py-2 border rounded-lg"
                  value={editingUser.password}
                  onChange={e => setEditingUser({...editingUser, password: e.target.value})}
                  placeholder="********"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('users.role')}</label>
                <select 
                  className="w-full px-3 py-2 border rounded-lg"
                  value={editingUser.role}
                  onChange={e => setEditingUser({...editingUser, role: e.target.value})}
                >
                  <option value="requester">{t('users.roles.requester')}</option>
                  <option value="lab_tech">{t('users.roles.lab_tech')}</option>
                  <option value="admin">{t('users.roles.admin')}</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 text-slate-600">{t('common.cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg">{t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportModal({ requests, onClose }: { requests: Request[], onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [selectedSample, setSelectedSample] = useState<string>('all');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    'sample_name', 'lot_number', 'lab_number', 'tube_count', 'processing_day', 'status', 'created_at'
  ]);

  const columns = [
    { id: 'sample_name', label: t('dashboard.table.sampleName') },
    { id: 'case_name', label: t('dashboard.table.caseName') },
    { id: 'lot_number', label: t('dashboard.table.lotNumber') },
    { id: 'lab_number', label: t('dashboard.table.labNumber') },
    { id: 'tube_count', label: t('dashboard.table.tubes') },
    { id: 'processing_day', label: t('dashboard.table.day') },
    { id: 'status', label: t('dashboard.table.status') },
    { id: 'created_at', label: t('dashboard.table.createdAt') },
    { id: 'received_at', label: t('dashboard.table.receivedAt') },
    { id: 'test_codes', label: t('dashboard.table.tests') },
  ];

  const uniqueSamples = Array.from(new Set(requests.map(r => r.sample_name))).sort();

  const toggleColumn = (id: string) => {
    if (selectedColumns.includes(id)) {
      setSelectedColumns(selectedColumns.filter(c => c !== id));
    } else {
      setSelectedColumns([...selectedColumns, id]);
    }
  };

  const generatePDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    
    // Filter requests
    const filteredData = selectedSample === 'all' 
      ? requests 
      : requests.filter(r => r.sample_name === selectedSample);

    // Prepare table data
    const tableColumn = selectedColumns.map(colId => columns.find(c => c.id === colId)?.label || colId);
    const tableRows = filteredData.map(req => {
      return selectedColumns.map(colId => {
        const val = (req as any)[colId];
        if (colId === 'created_at' || colId === 'received_at') {
          return formatThaiDate(val);
        }
        if (colId === 'test_codes') {
          return val || '-';
        }
        return val ?? '-';
      });
    });

    // Add title
    doc.setFontSize(18);
    doc.text(t('reports.title'), 14, 15);
    doc.setFontSize(10);
    doc.text(`${t('reports.info')}: ${new Date().toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-US')}`, 14, 22);
    if (selectedSample !== 'all') {
      doc.text(`${t('reports.filterBySample')}: ${selectedSample}`, 14, 27);
    }

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 35,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });

    doc.save(`lab-report-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`);
  };

  const handlePrint = () => {
    const filteredData = selectedSample === 'all' 
      ? requests 
      : requests.filter(r => r.sample_name === selectedSample);

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const tableHeader = selectedColumns.map(colId => `<th>${columns.find(c => c.id === colId)?.label || colId}</th>`).join('');
    const tableRows = filteredData.map(req => {
      const cells = selectedColumns.map(colId => {
        let val = (req as any)[colId];
        if (colId === 'created_at' || colId === 'received_at') {
          val = formatThaiDate(val);
        }
        return `<td>${val ?? '-'}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>${t('reports.title')} - ${selectedSample}</title>
          <style>
            body { font-family: 'Sarabun', sans-serif; padding: 20px; }
            h1 { color: #333; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
            th { background-color: #4f46e5; color: white; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            @media print {
              @page { size: A4 landscape; margin: 10mm; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>${t('reports.title')}</h1>
          <p>${t('reports.info')}: ${new Date().toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-US')}</p>
          ${selectedSample !== 'all' ? `<p>${t('reports.filterBySample')}: ${selectedSample}</p>` : ''}
          <table>
            <thead><tr>${tableHeader}</tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
          <script>
            window.onload = () => {
              window.print();
              // window.close();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-bold text-slate-900">{t('reports.title')}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <LogOut className="w-5 h-5 rotate-45" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Filter Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">{t('reports.filterBySample')}</label>
              <select 
                value={selectedSample}
                onChange={(e) => setSelectedSample(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
              >
                <option value="all">{t('reports.allSamples')}</option>
                {uniqueSamples.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button 
                onClick={() => setSelectedColumns(columns.map(c => c.id))}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 uppercase"
              >
                {t('reports.selectAll')}
              </button>
              <span className="text-slate-300">|</span>
              <button 
                onClick={() => setSelectedColumns(['sample_name'])}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 uppercase"
              >
                {t('reports.reset')}
              </button>
            </div>
          </div>

          {/* Column Selection Section */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-3">{t('reports.selectContent')}</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
              {columns.map(col => (
                <label key={col.id} className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                    selectedColumns.includes(col.id) 
                      ? 'bg-indigo-600 border-indigo-600 text-white' 
                      : 'bg-white border-slate-300 group-hover:border-indigo-400'
                  }`}>
                    <input 
                      type="checkbox" 
                      className="hidden"
                      checked={selectedColumns.includes(col.id)}
                      onChange={() => toggleColumn(col.id)}
                    />
                    {selectedColumns.includes(col.id) && <CheckCircle className="w-3.5 h-3.5" />}
                  </div>
                  <span className={`text-sm font-medium transition-colors ${
                    selectedColumns.includes(col.id) ? 'text-slate-900' : 'text-slate-500'
                  }`}>
                    {col.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 flex items-start gap-3">
            <div className="bg-white p-1.5 rounded-lg shadow-sm">
              <Printer className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-indigo-900 uppercase tracking-wider">{t('reports.info')}</p>
              <p className="text-xs text-indigo-700 mt-0.5">
                {t('reports.infoDesc', { cols: selectedColumns.length, rows: selectedSample === 'all' ? requests.length : requests.filter(r => r.sample_name === selectedSample).length })}
                <br />
                <span className="font-bold">{t('reports.tip')}</span>
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button 
              onClick={onClose} 
              className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg font-medium transition-colors"
            >
              {t('common.cancel')}
            </button>
            <div className="flex gap-2">
              <button 
                onClick={handlePrint}
                className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-lg font-bold shadow-sm transition-all active:scale-95"
              >
                <Printer className="w-4 h-4 text-slate-500" />
                {t('reports.print')}
              </button>
              <button 
                onClick={generatePDF}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold shadow-md shadow-indigo-200 transition-all active:scale-95"
              >
                <Download className="w-4 h-4" />
                {t('reports.download')}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function TestManagement({ token }: { token: string }) {
  const { t } = useTranslation();
  const [tests, setTests] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTestId, setEditingTestId] = useState<number | null>(null);
  const [newTest, setNewTest] = useState({ code: '', name: '', description: '', price: '', reference_range: '' });

  const fetchTests = async () => {
    const res = await fetch('/api/tests', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setTests(await res.json());
  };

  useEffect(() => {
    fetchTests();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingTestId ? `/api/tests/${editingTestId}` : '/api/tests';
      const method = editingTestId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newTest)
      });
      if (res.ok) {
        setShowAddModal(false);
        setEditingTestId(null);
        setNewTest({ code: '', name: '', description: '', price: '', reference_range: '' });
        fetchTests();
        triggerAutoDriveSync(token);
      } else {
        const errorData = await res.json();
        alert(errorData.error || 'Failed to save test');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEdit = (test: any) => {
    setNewTest({ code: test.code, name: test.name, description: test.description || '', price: test.price, reference_range: test.reference_range || '' });
    setEditingTestId(test.id);
    setShowAddModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('common.confirmDelete') || 'Are you sure you want to delete this test?')) return;
    try {
      const res = await fetch(`/api/tests/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchTests();
        triggerAutoDriveSync(token);
      } else {
        const errorData = await res.json();
        alert(errorData.error || 'Failed to delete test');
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-slate-900">{t('tests.title')}</h3>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {t('tests.add')}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('tests.code')}</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('tests.name')}</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('tests.referenceRange')}</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">{t('tests.price')}</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">{t('common.actions') || 'Actions'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tests.map(test => (
              <tr key={test.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-mono text-slate-600">{test.code}</td>
                <td className="px-6 py-4 text-sm font-medium text-slate-900">{test.name}</td>
                <td className="px-6 py-4 text-sm text-slate-500">{test.reference_range}</td>
                <td className="px-6 py-4 text-sm text-slate-900">${test.price}</td>
                <td className="px-6 py-4 text-sm text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => handleEdit(test)} className="p-1 text-slate-400 hover:text-indigo-600 transition-colors" title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(test.id)} className="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">{editingTestId ? t('common.edit') || 'Edit Test' : t('tests.add')}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input 
                  placeholder={t('tests.code')} 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                  value={newTest.code}
                  onChange={e => setNewTest({...newTest, code: e.target.value})}
                  required
                />
                <input 
                  placeholder={t('tests.price')} 
                  type="number"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                  value={newTest.price}
                  onChange={e => setNewTest({...newTest, price: e.target.value})}
                  required
                />
              </div>
              <input 
                placeholder={t('tests.name')} 
                className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                value={newTest.name}
                onChange={e => setNewTest({...newTest, name: e.target.value})}
                required
              />
              <input 
                placeholder={t('tests.referenceRange')} 
                className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                value={newTest.reference_range}
                onChange={e => setNewTest({...newTest, reference_range: e.target.value})}
              />
              <textarea 
                placeholder={t('tests.description')} 
                className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                value={newTest.description}
                onChange={e => setNewTest({...newTest, description: e.target.value})}
              />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddModal(false); setEditingTestId(null); setNewTest({ code: '', name: '', description: '', price: '', reference_range: '' }); }} className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg font-medium">{t('common.cancel')}</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm">{t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsManagement({ token, onUpdate, currentSettings }: { token: string, onUpdate: () => void, currentSettings: any }) {
  const { t } = useTranslation();
  const [appName, setAppName] = useState(currentSettings.app_name);
  const [updating, setUpdating] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ app_name: appName })
      });
      if (res.ok) {
        onUpdate();
        triggerAutoDriveSync(token);
        alert(t('settings.success'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('logo', e.target.files[0]);

    try {
      const res = await fetch('/api/settings/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        onUpdate();
        triggerAutoDriveSync(token);
        alert('Logo updated successfully!');
      } else {
        const data = await res.json();
        alert(data.error || 'Logo upload failed');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-indigo-100 p-2 rounded-lg">
          <Activity className="w-5 h-5 text-indigo-600" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">{t('settings.title')}</h3>
      </div>
      
      <div className="space-y-8">
        {/* App Name Section */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">{t('settings.sections.general')}</h4>
          <form onSubmit={handleUpdateName} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('settings.programName')}</label>
              <input 
                type="text"
                value={appName}
                onChange={e => setAppName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                placeholder="Enter program name"
              />
            </div>
            <button 
              type="submit"
              disabled={updating || appName === currentSettings.app_name}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-6 py-2 rounded-xl font-medium transition-all shadow-sm shadow-indigo-100"
            >
              {updating ? 'Updating...' : t('settings.save')}
            </button>
          </form>
        </div>

        {/* Logo Section */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">{t('settings.sections.branding')}</h4>
          <div className="flex items-start gap-6">
            <div className="w-24 h-24 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center overflow-hidden">
              {currentSettings.app_logo ? (
                <img src={currentSettings.app_logo} alt="Current Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              ) : (
                <Activity className="w-8 h-8 text-slate-300" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 mb-1">{t('settings.programLogo')}</p>
              <p className="text-xs text-slate-500 mb-4">{t('settings.logoInfo')}</p>
              <label className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-xl font-medium cursor-pointer transition-all shadow-sm">
                <Upload className={`w-4 h-4 ${uploading ? 'animate-pulse' : ''}`} />
                {uploading ? t('common.uploading') : t('settings.upload')}
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
              </label>
            </div>
          </div>
        </div>

        {/* Google Drive Database Persistence Section */}
        <GoogleDrivePersistence token={token} onRefreshData={onUpdate} />
      </div>
    </div>
  );
}
