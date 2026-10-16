import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Beaker, Lock, User, Eye, EyeOff, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState({ app_name: 'LabFlow LIS', app_logo: '' });
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.app_name) setSettings(data);
      })
      .catch(console.error);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      
      if (!res.ok) throw new Error('Invalid credentials');
      
      const data = await res.json();
      login(data.token, data.user);
      navigate('/dashboard');
    } catch (err) {
      setError(t('login.failed'));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4 flex items-center gap-1 bg-white p-1 rounded-lg shadow-sm border border-slate-200">
        <button 
          onClick={() => i18n.changeLanguage('en')}
          className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${i18n.language === 'en' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          EN
        </button>
        <button 
          onClick={() => i18n.changeLanguage('th')}
          className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${i18n.language === 'th' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          TH
        </button>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100"
      >
        <div className="flex justify-center mb-6">
          <div className="bg-indigo-100 p-3 rounded-full overflow-hidden flex items-center justify-center w-16 h-16">
            {settings.app_logo ? (
              <img src={settings.app_logo} alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
            ) : (
              <Beaker className="w-8 h-8 text-indigo-600" />
            )}
          </div>
        </div>
        <h1 className="text-2xl font-bold text-center text-slate-900 mb-2">{settings.app_name}</h1>
        <p className="text-center text-slate-500 mb-8">{t('login.subtitle')}</p>
        
        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-6 border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('login.username')}</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder={t('login.usernamePlaceholder')}
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('login.password')}</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-12 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder={t('login.passwordPlaceholder')}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-xl transition-colors shadow-sm shadow-indigo-200"
          >
            {t('login.signIn')}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center text-xs text-slate-400">
          <p>{t('login.demoAccounts')}:</p>
          <div className="flex justify-center gap-4 mt-2">
            <span>admin / password123</span>
            <span>doctor / password123</span>
            <span>lab / password123</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
