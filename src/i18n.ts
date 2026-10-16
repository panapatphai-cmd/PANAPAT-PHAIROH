import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      menu: {
        dashboard: 'Dashboard',
        samples: 'Samples',
        tests: 'Tests',
        reports: 'Reports',
        users: 'Users',
        logs: 'Activity Logs',
        settings: 'Settings',
        logout: 'Logout'
      },
      dashboard: {
        title: 'Dashboard',
        welcome: 'Welcome back',
        stats: {
          total: 'Total Requests',
          pending: 'Pending',
          inProgress: 'In Progress',
          completed: 'Completed'
        },
        table: {
          sampleName: 'Sample Name',
          caseName: 'Case Name',
          lotNumber: 'Lot Number',
          labNumber: 'Lab Number',
          tubes: 'Tubes',
          day: 'Day',
          status: 'Status',
          createdAt: 'Created At',
          receivedAt: 'Confirmed At',
          tests: 'Tests',
          actions: 'Actions',
          items: 'items',
          statuses: {
            pending: 'Pending',
            received: 'Received',
            completed: 'Completed'
          },
          stages: {
            initial: 'Initial (IN)',
            inProcess: 'In Process (IP)',
            finishProduct: 'Finish Product (FP)'
          }
        }
      },
      samples: {
        title: 'Sample Management',
        add: 'Add New Sample',
        table: {
          id: 'Sample ID',
          patient: 'Patient Name',
          type: 'Type',
          status: 'Status',
          date: 'Date Received'
        }
      },
      settings: {
        title: 'Application Settings',
        programName: 'Program Name',
        programLogo: 'Program Logo',
        save: 'Save Changes',
        upload: 'Upload New Logo',
        success: 'Application name updated successfully!',
        sections: {
          general: 'General Settings',
          branding: 'Branding',
          drive: 'Google Drive Persistence'
        },
        logoInfo: 'Upload a square image (PNG, JPG). Max size 2MB.'
      },
      drive: {
        title: 'Google Drive Database Persistence',
        description: 'Permanently store and sync all laboratory database records directly to Google Drive so data is never lost when closing the app.',
        targetFolder: 'Target Google Drive Folder',
        connectGoogle: 'Connect Google Account',
        disconnectGoogle: 'Disconnect',
        connectedAs: 'Connected as',
        syncNow: 'Sync Database to Drive',
        syncing: 'Syncing to Drive...',
        syncSuccess: 'Database synced to Google Drive successfully!',
        restoreFromDrive: 'Restore from Google Drive',
        restoring: 'Restoring from Drive...',
        restoreSuccess: 'Database restored successfully from Google Drive!',
        openFolder: 'Open Google Drive Folder',
        lastSynced: 'Last Synced',
        neverSynced: 'Never synced',
        confirmSyncTitle: 'Confirm Sync to Google Drive',
        confirmSyncMessage: 'This will save the current laboratory database (all requests, tests, and users) to the target Google Drive folder. Existing database in this folder will be updated. Do you want to proceed?',
        confirmRestoreTitle: 'Confirm Restore from Google Drive',
        confirmRestoreMessage: 'Warning: This will overwrite the local database with the database file from Google Drive. Are you sure you want to proceed?',
        autoSync: 'Auto-sync database on changes',
        folderId: 'Folder ID',
        needSignIn: 'Sign in with Google to enable Drive sync'
      },
      users: {
        title: 'User Management',
        add: 'Add New User',
        edit: 'Edit User',
        name: 'Full Name',
        username: 'Username',
        password: 'Password',
        role: 'Role',
        createdAt: 'Created At',
        roles: {
          admin: 'Admin',
          lab_tech: 'Lab Technician',
          requester: 'Requester'
        },
        leaveBlank: 'leave blank to keep current'
      },
      tests: {
        title: 'Test Management',
        add: 'Add New Test',
        code: 'Code',
        name: 'Name',
        price: 'Price',
        referenceRange: 'Reference Range',
        description: 'Description'
      },
      reports: {
        title: 'Generate Summary Report',
        filterBySample: 'Filter by Sample Name',
        allSamples: 'All Samples',
        selectContent: 'Select Content to Include',
        selectAll: 'Select All',
        reset: 'Reset',
        info: 'Report Info',
        infoDesc: 'A4 Landscape format. {{cols}} columns, {{rows}} rows.',
        tip: 'Tip: Use "Print" for best Thai font support.',
        print: 'Print',
        download: 'Download PDF'
      },
      notifications: {
        title: 'Notifications',
        empty: 'No new notifications'
      },
      modals: {
        delete: {
          title: 'Confirm Deletion',
          message: 'Are you sure you want to delete this request? This action cannot be undone.'
        },
        receive: {
          title: 'Receive Sample',
          lotNumber: 'Lot Number',
          caseName: 'Patient Name / Case Name',
          tubes: 'Number of Tubes',
          day: 'Processing Day',
          sampleType: 'Sample Type / Stage',
          selectTests: 'Select Tests'
        }
      },
      common: {
        search: 'Search...',
        actions: 'Actions',
        edit: 'Edit',
        delete: 'Delete',
        cancel: 'Cancel',
        save: 'Save',
        language: 'Language',
        uploading: 'Uploading...'
      },
      login: {
        signIn: 'Sign In',
        subtitle: 'Sign in to access the laboratory system',
        username: 'Username',
        password: 'Password',
        usernamePlaceholder: 'Enter username',
        passwordPlaceholder: 'Enter password',
        failed: 'Login failed. Please check your username and password.',
        demoAccounts: 'Demo Accounts'
      }
    }
  },
  th: {
    translation: {
      menu: {
        dashboard: 'แผงควบคุม',
        samples: 'ตัวอย่าง',
        tests: 'การทดสอบ',
        reports: 'รายงาน',
        users: 'ผู้ใช้งาน',
        logs: 'ประวัติกิจกรรม (Logs)',
        settings: 'ตั้งค่า',
        logout: 'ออกจากระบบ'
      },
      dashboard: {
        title: 'แผงควบคุม',
        welcome: 'ยินดีต้อนรับกลับ',
        stats: {
          total: 'คำขอทั้งหมด',
          pending: 'รอดำเนินการ',
          inProgress: 'กำลังดำเนินการ',
          completed: 'เสร็จสมบูรณ์'
        },
        table: {
          sampleName: 'ชื่อตัวอย่าง',
          caseName: 'ชื่อผู้ป่วย / ชื่อเคส',
          lotNumber: 'เลขล็อต',
          labNumber: 'เลขแล็บ',
          tubes: 'จำนวนหลอด',
          day: 'วัน',
          status: 'สถานะ',
          createdAt: 'วันที่สร้าง',
          receivedAt: 'วันที่ยืนยัน',
          tests: 'การทดสอบ',
          actions: 'การดำเนินการ',
          items: 'รายการ',
          statuses: {
            pending: 'รอดำเนินการ',
            received: 'ได้รับแล้ว',
            completed: 'เสร็จสมบูรณ์'
          },
          stages: {
            initial: 'เริ่มต้น (IN)',
            inProcess: 'ระหว่างดำเนินการ (IP)',
            finishProduct: 'ผลิตภัณฑ์สำเร็จรูป (FP)'
          }
        }
      },
      samples: {
        title: 'การจัดการตัวอย่าง',
        add: 'เพิ่มตัวอย่างใหม่',
        table: {
          id: 'รหัสตัวอย่าง',
          patient: 'ชื่อผู้ป่วย',
          type: 'ประเภท',
          status: 'สถานะ',
          date: 'วันที่ได้รับ'
        }
      },
      settings: {
        title: 'การตั้งค่าแอปพลิเคชัน',
        programName: 'ชื่อโปรแกรม',
        programLogo: 'โลโก้โปรแกรม',
        save: 'บันทึกการเปลี่ยนแปลง',
        upload: 'อัปโหลดโลโก้ใหม่',
        success: 'อัปเดตชื่อแอปพลิเคชันสำเร็จ!',
        sections: {
          general: 'การตั้งค่าทั่วไป',
          branding: 'แบรนด์',
          drive: 'การบันทึกฐานข้อมูลถาวรบน Google Drive'
        },
        logoInfo: 'อัปโหลดรูปภาพสี่เหลี่ยมจัตุรัส (PNG, JPG) ขนาดสูงสุด 2MB'
      },
      drive: {
        title: 'การจัดเก็บและสำรองฐานข้อมูลถาวรบน Google Drive',
        description: 'จัดเก็บและซิงค์ฐานข้อมูลทั้งหมด (คำขอตรวจ, การทดสอบ, ผู้ใช้งาน) บน Google Drive ถาวร เพื่อป้องกันข้อมูลสูญหายหลังปิดโปรแกรม',
        targetFolder: 'โฟลเดอร์ Google Drive ปลายทาง',
        connectGoogle: 'เชื่อมต่อบัญชี Google',
        disconnectGoogle: 'ยกเลิกการเชื่อมต่อ',
        connectedAs: 'เชื่อมต่อแล้วในชื่อ',
        syncNow: 'บันทึกฐานข้อมูลลง Drive ทันที',
        syncing: 'กำลังซิงค์ข้อมูลลง Drive...',
        syncSuccess: 'บันทึกฐานข้อมูลลง Google Drive สำเร็จเรียบร้อย!',
        restoreFromDrive: 'ดึงข้อมูลคืนจาก Google Drive',
        restoring: 'กำลังดึงข้อมูลคืนจาก Drive...',
        restoreSuccess: 'กู้คืนฐานข้อมูลจาก Google Drive สำเร็จเรียบร้อย!',
        openFolder: 'เปิดโฟลเดอร์ Google Drive',
        lastSynced: 'ซิงค์ล่าสุดเมื่อ',
        neverSynced: 'ยังไม่เคยซิงค์',
        confirmSyncTitle: 'ยืนยันการบันทึกฐานข้อมูลลง Google Drive',
        confirmSyncMessage: 'ระบบจะส่งไฟล์ฐานข้อมูลห้องปฏิบัติการล่าสุดไปเก็บที่โฟลเดอร์ Google Drive ที่กำหนด ไฟล์ฐานข้อมูลเดิมในโฟลเดอร์นี้จะได้รับการอัปเดต คุณต้องการดำเนินการต่อหรือไม่?',
        confirmRestoreTitle: 'ยืนยันการกู้คืนฐานข้อมูลจาก Google Drive',
        confirmRestoreMessage: 'คำเตือน: การกระทำนี้จะแทนที่ฐานข้อมูลปัจจุบันในเครื่องด้วยไฟล์ฐานข้อมูลที่ดึงมาจาก Google Drive คุณแน่ใจหรือไม่ว่าต้องการดำเนินการต่อ?',
        autoSync: 'ซิงค์ฐานข้อมูลลง Drive อัตโนมัติเมื่อมีการเปลี่ยนแปลง',
        folderId: 'รหัสโฟลเดอร์',
        needSignIn: 'ลงชื่อเข้าใช้ด้วย Google เพื่อเปิดใช้งานการซิงค์ข้อมูล Drive'
      },
      users: {
        title: 'การจัดการผู้ใช้งาน',
        add: 'เพิ่มผู้ใช้งานใหม่',
        edit: 'แก้ไขผู้ใช้งาน',
        name: 'ชื่อ-นามสกุล',
        username: 'ชื่อผู้ใช้งาน',
        password: 'รหัสผ่าน',
        role: 'บทบาท',
        createdAt: 'วันที่สร้าง',
        roles: {
          admin: 'ผู้ดูแลระบบ',
          lab_tech: 'เจ้าหน้าที่แล็บ',
          requester: 'ผู้ส่งตรวจ'
        },
        leaveBlank: 'เว้นว่างไว้หากไม่ต้องการเปลี่ยน'
      },
      tests: {
        title: 'การจัดการการทดสอบ',
        add: 'เพิ่มการทดสอบใหม่',
        code: 'รหัส',
        name: 'ชื่อ',
        price: 'ราคา',
        referenceRange: 'ค่าอ้างอิง',
        description: 'คำอธิบาย'
      },
      reports: {
        title: 'สร้างรายงานสรุป',
        filterBySample: 'กรองตามชื่อตัวอย่าง',
        allSamples: 'ตัวอย่างทั้งหมด',
        selectContent: 'เลือกเนื้อหาที่จะรวม',
        selectAll: 'เลือกทั้งหมด',
        reset: 'รีเซ็ต',
        info: 'ข้อมูลรายงาน',
        infoDesc: 'รูปแบบ A4 แนวนอน {{cols}} คอลัมน์ {{rows}} แถว',
        tip: 'คำแนะนำ: ใช้ "พิมพ์" เพื่อการรองรับฟอนต์ภาษาไทยที่ดีที่สุด',
        print: 'พิมพ์',
        download: 'ดาวน์โหลด PDF'
      },
      notifications: {
        title: 'การแจ้งเตือน',
        empty: 'ไม่มีการแจ้งเตือนใหม่'
      },
      modals: {
        delete: {
          title: 'ยืนยันการลบ',
          message: 'คุณแน่ใจหรือไม่ว่าต้องการลบคำขอนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้'
        },
        receive: {
          title: 'รับตัวอย่าง',
          lotNumber: 'เลขล็อต',
          caseName: 'ชื่อผู้ป่วย / ชื่อเคส',
          tubes: 'จำนวนหลอด',
          day: 'วันที่ดำเนินการ',
          sampleType: 'ประเภทตัวอย่าง / ขั้นตอน',
          selectTests: 'เลือกการทดสอบ'
        }
      },
      common: {
        search: 'ค้นหา...',
        actions: 'การดำเนินการ',
        edit: 'แก้ไข',
        delete: 'ลบ',
        cancel: 'ยกเลิก',
        save: 'บันทึก',
        language: 'ภาษา',
        uploading: 'กำลังอัปโหลด...'
      },
      login: {
        signIn: 'เข้าสู่ระบบ',
        subtitle: 'เข้าสู่ระบบเพื่อเข้าถึงระบบห้องปฏิบัติการ',
        username: 'ชื่อผู้ใช้งาน',
        password: 'รหัสผ่าน',
        usernamePlaceholder: 'กรอกชื่อผู้ใช้งาน',
        passwordPlaceholder: 'กรอกรหัสผ่าน',
        failed: 'การเข้าสู่ระบบล้มเหลว โปรดตรวจสอบชื่อผู้ใช้งานและรหัสผ่านของคุณ',
        demoAccounts: 'บัญชีทดลอง'
      }
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
