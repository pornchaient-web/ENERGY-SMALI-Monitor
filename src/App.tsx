import React, { useState, useEffect } from "react";
import { db } from "./firebase";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  writeBatch,
  doc,
  setDoc,
  where,
} from "firebase/firestore";
import { PowerReading } from "./types";
import { 
  getReadingDate, 
  getCurrentBillingPeriod, 
  getKWhConsumedInPeriod, 
  calculateProgressiveCost 
} from "./utils/billing";
import { motion } from "motion/react";
import {
  Zap,
  Activity,
  Cpu,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Clock,
  Coins,
  ArrowUpRight,
  TrendingUp,
  RefreshCw,
  Calendar,
  Sun,
  Moon,
  Bolt,
  Waves,
  Percent,
  Bell,
  BellRing,
  Volume2,
  VolumeX,
  ShieldAlert,
  CheckCircle,
  Download,
  Database,
  Info,
  Layers,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Search,
  Play,
  Square,
  Sliders,
  X,
} from "lucide-react";

import ChartSection from "./components/ChartSection";
import HardwareGuide from "./components/HardwareGuide";

export default function App() {
  const [readings, setReadings] = useState<PowerReading[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [historyReadings, setHistoryReadings] = useState<PowerReading[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("pzem_theme") !== "light"; // default to dark
  });

  const toggleTheme = () => {
    const nextTheme = !isDarkMode;
    setIsDarkMode(nextTheme);
    localStorage.setItem("pzem_theme", nextTheme ? "dark" : "light");
  };
  const [ftRate, setFtRate] = useState<number>(() => {
    return parseFloat(localStorage.getItem("pzem_ft_rate") || "0.3972");
  });
  const [serviceFeeMode, setServiceFeeMode] = useState<"auto" | "custom">(() => {
    return (localStorage.getItem("pzem_service_fee_mode") as "auto" | "custom") || "auto";
  });
  const [customServiceFee, setCustomServiceFee] = useState<number>(() => {
    return parseFloat(localStorage.getItem("pzem_custom_service_fee") || "38.22");
  });
  const [vatPercent, setVatPercent] = useState<number>(() => {
    return parseFloat(localStorage.getItem("pzem_vat_percent") || "7");
  });
  const [billingStartMeterMode, setBillingStartMeterMode] = useState<"auto" | "custom">(() => {
    return (localStorage.getItem("pzem_billing_start_meter_mode") as "auto" | "custom") || "auto";
  });
  const [billingStartMeter, setBillingStartMeter] = useState<number>(() => {
    return parseFloat(localStorage.getItem("pzem_billing_start_meter") || "0");
  });
  const [isClearing, setIsClearing] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "history" | "settings" | "about">("dashboard");
  const [meterOffset, setMeterOffset] = useState<number>(() => {
    return parseFloat(localStorage.getItem("pzem_meter_offset") || "0");
  });
  const [todayFirstReading, setTodayFirstReading] = useState<PowerReading | null>(null);
  const [billingFirstReading, setBillingFirstReading] = useState<PowerReading | null>(null);

  // Alert settings states
  const [overpowerThreshold, setOverpowerThreshold] = useState<number>(() => {
    return parseFloat(localStorage.getItem("pzem_overpower_threshold") || "2000"); // 2000 Watts
  });
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem("pzem_sound_enabled") !== "false";
  });
  const [isOverpowerAlertEnabled, setIsOverpowerAlertEnabled] = useState<boolean>(() => {
    return localStorage.getItem("pzem_overpower_enabled") !== "false";
  });
  const [isOnlineOfflineAlertEnabled, setIsOnlineOfflineAlertEnabled] = useState<boolean>(() => {
    return localStorage.getItem("pzem_online_offline_enabled") !== "false";
  });
  const [autoPruneDays, setAutoPruneDays] = useState<number>(() => {
    return parseInt(localStorage.getItem("pzem_auto_prune_days") || "0");
  });

  // Native HTML5 Browser Push Notification State
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<string>(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission;
    }
    return "unsupported";
  });

  const requestNotificationPermission = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      try {
        const result = await Notification.requestPermission();
        setBrowserNotificationPermission(result);
        if (result === "granted") {
          const title = "เปิดระบบแจ้งเตือนสำเร็จ! 🎉";
          const options = {
            body: "คุณจะได้รับการแจ้งเตือนสถานะอุปกรณ์ PZEM-004T ทันทีแม้ในขณะที่ไม่ได้มองหน้าจอแอปนี้ค้างไว้",
            icon: "./icon-512.jpg",
            badge: "./icon-512.jpg",
            vibrate: [200, 100, 200]
          };

          if ("serviceWorker" in navigator) {
            navigator.serviceWorker.ready.then((reg) => {
              reg.showNotification(title, options);
            }).catch(() => {
              new Notification(title, options);
            });
          } else {
            new Notification(title, options);
          }

          setIsNotificationPromptDismissed(true);
          localStorage.setItem("pzem_notif_prompt_dismissed", "true");
        }
      } catch (e) {
        console.error("Error requesting notification permission:", e);
      }
    }
  };


  // Notification lists state (persisted in localStorage)
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    type: "online" | "offline" | "overpower" | "overpower_normal";
    title: string;
    message: string;
    timestamp: string;
    read: boolean;
  }>>(() => {
    try {
      const stored = localStorage.getItem("pzem_notifications");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [prevOnline, setPrevOnline] = useState<boolean | null>(null);
  const [isOverpowerActive, setIsOverpowerActive] = useState<boolean>(false);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState<boolean>(false);
  const [isOfflineBannerDismissed, setIsOfflineBannerDismissed] = useState<boolean>(true);
  const [isNotificationPromptDismissed, setIsNotificationPromptDismissed] = useState<boolean>(() => {
    return localStorage.getItem("pzem_notif_prompt_dismissed") === "true";
  });
  const [isFirestoreQuotaExceeded, setIsFirestoreQuotaExceeded] = useState<boolean>(false);
  const [firestoreErrorMessage, setFirestoreErrorMessage] = useState<string>("");
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  const [showStepBreakdown, setShowStepBreakdown] = useState(false);
  const [showTodayBreakdown, setShowTodayBreakdown] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "today" | "yesterday" | "7days" | "1month" | "billing">("today");
  const [selectedBillingPeriodIndex, setSelectedBillingPeriodIndex] = useState<number>(0);

  // History Tab Pagination & Search State
  const [historySearch, setHistorySearch] = useState<string>("");
  const [historyPage, setHistoryPage] = useState<number>(1);
  const historyItemsPerPage = 15;

  useEffect(() => {
    setHistoryPage(1);
  }, [historyFilter, historySearch]);

  // Temporary editing states for billing & alert parameters to support confirmation before saving
  const [tempFtRate, setTempFtRate] = useState<number>(ftRate);
  const [tempServiceFeeMode, setTempServiceFeeMode] = useState<"auto" | "custom">(serviceFeeMode);
  const [tempCustomServiceFee, setTempCustomServiceFee] = useState<number>(customServiceFee);
  const [tempVatPercent, setTempVatPercent] = useState<number>(vatPercent);
  const [tempBillingStartMeterMode, setTempBillingStartMeterMode] = useState<"auto" | "custom">(billingStartMeterMode);
  const [tempBillingStartMeter, setTempBillingStartMeter] = useState<number>(billingStartMeter);
  
  const [tempOverpowerThreshold, setTempOverpowerThreshold] = useState<number>(overpowerThreshold);
  const [tempIsSoundEnabled, setTempIsSoundEnabled] = useState<boolean>(isSoundEnabled);
  const [tempIsOverpowerAlertEnabled, setTempIsOverpowerAlertEnabled] = useState<boolean>(isOverpowerAlertEnabled);
  const [tempIsOnlineOfflineAlertEnabled, setTempIsOnlineOfflineAlertEnabled] = useState<boolean>(isOnlineOfflineAlertEnabled);
  const [tempAutoPruneDays, setTempAutoPruneDays] = useState<number>(autoPruneDays);

  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  // PWA States and Logic
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isPWAInstalled, setIsPWAInstalled] = useState<boolean>(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt as any);

    if (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone) {
      setIsPWAInstalled(true);
    }

    const handleAppInstalled = () => {
      setIsPWAInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as any);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA install prompt choice: ${outcome}`);
    setDeferredPrompt(null);
  };



  // Synchronize temp states with actual settings when they are loaded/updated from Firestore
  useEffect(() => {
    setTempFtRate(ftRate);
    setTempServiceFeeMode(serviceFeeMode);
    setTempCustomServiceFee(customServiceFee);
    setTempVatPercent(vatPercent);
    setTempBillingStartMeterMode(billingStartMeterMode);
    setTempBillingStartMeter(billingStartMeter);
    setTempOverpowerThreshold(overpowerThreshold);
    setTempIsSoundEnabled(isSoundEnabled);
    setTempIsOverpowerAlertEnabled(isOverpowerAlertEnabled);
    setTempIsOnlineOfflineAlertEnabled(isOnlineOfflineAlertEnabled);
    setTempAutoPruneDays(autoPruneDays);
  }, [ftRate, serviceFeeMode, customServiceFee, vatPercent, billingStartMeterMode, billingStartMeter, overpowerThreshold, isSoundEnabled, isOverpowerAlertEnabled, isOnlineOfflineAlertEnabled, autoPruneDays]);

  const isSettingsChanged = 
    tempFtRate !== ftRate ||
    tempServiceFeeMode !== serviceFeeMode ||
    tempCustomServiceFee !== customServiceFee ||
    tempVatPercent !== vatPercent ||
    tempBillingStartMeterMode !== billingStartMeterMode ||
    tempBillingStartMeter !== billingStartMeter ||
    tempOverpowerThreshold !== overpowerThreshold ||
    tempIsSoundEnabled !== isSoundEnabled ||
    tempIsOverpowerAlertEnabled !== isOverpowerAlertEnabled ||
    tempIsOnlineOfflineAlertEnabled !== isOnlineOfflineAlertEnabled ||
    tempAutoPruneDays !== autoPruneDays;

  // Helper to update settings in Firestore so all devices stay synchronized
  const updateGlobalSetting = async (key: string, value: any) => {
    try {
      await setDoc(doc(db, "device_status", "global_settings"), { [key]: value }, { merge: true });
    } catch (e) {
      console.error("Error writing settings to Firestore:", e);
    }
  };

  // Helper to update multiple settings in Firestore at once
  const updateGlobalSettings = async (settingsObj: Record<string, any>) => {
    try {
      await setDoc(doc(db, "device_status", "global_settings"), settingsObj, { merge: true });
    } catch (e) {
      console.error("Error writing multiple settings to Firestore:", e);
    }
  };

  // Subscribe to global settings in Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "device_status", "global_settings"),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.ftRate !== undefined) setFtRate(data.ftRate);
          if (data.serviceFeeMode !== undefined) setServiceFeeMode(data.serviceFeeMode);
          if (data.customServiceFee !== undefined) setCustomServiceFee(data.customServiceFee);
          if (data.vatPercent !== undefined) setVatPercent(data.vatPercent);
          if (data.billingStartMeterMode !== undefined) setBillingStartMeterMode(data.billingStartMeterMode);
          if (data.billingStartMeter !== undefined) setBillingStartMeter(data.billingStartMeter);
          if (data.meterOffset !== undefined) setMeterOffset(data.meterOffset);
          if (data.overpowerThreshold !== undefined) setOverpowerThreshold(data.overpowerThreshold);
          if (data.isSoundEnabled !== undefined) setIsSoundEnabled(data.isSoundEnabled);
          if (data.isOverpowerAlertEnabled !== undefined) setIsOverpowerAlertEnabled(data.isOverpowerAlertEnabled);
          if (data.isOnlineOfflineAlertEnabled !== undefined) setIsOnlineOfflineAlertEnabled(data.isOnlineOfflineAlertEnabled);
          if (data.autoPruneDays !== undefined) setAutoPruneDays(data.autoPruneDays);
          
          // Cache successful read
          localStorage.setItem("pzem_cached_settings", JSON.stringify(data));
        } else {
          // Initialize default values in Firestore if document doesn't exist
          setDoc(doc(db, "device_status", "global_settings"), {
            ftRate: 0.3972,
            serviceFeeMode: "auto",
            customServiceFee: 38.22,
            vatPercent: 7,
            billingStartMeterMode: "auto",
            billingStartMeter: 0,
            meterOffset: 0,
            overpowerThreshold: 2000,
            isSoundEnabled: true,
            isOverpowerAlertEnabled: true,
            isOnlineOfflineAlertEnabled: true,
            autoPruneDays: 0
          }).catch(err => console.error("Error creating initial settings document:", err));
        }
      },
      (error: any) => {
        console.error("Firestore settings sync error:", error);
        const isQuota = error?.message?.includes("Quota") || error?.message?.includes("quota") || error?.code === "resource-exhausted";
        if (isQuota) {
          setIsFirestoreQuotaExceeded(true);
          setFirestoreErrorMessage(error.message || "");
        }
        
        // Restore from cache
        const cached = localStorage.getItem("pzem_cached_settings");
        if (cached) {
          try {
            const data = JSON.parse(cached);
            if (data.ftRate !== undefined) setFtRate(data.ftRate);
            if (data.serviceFeeMode !== undefined) setServiceFeeMode(data.serviceFeeMode);
            if (data.customServiceFee !== undefined) setCustomServiceFee(data.customServiceFee);
            if (data.vatPercent !== undefined) setVatPercent(data.vatPercent);
            if (data.billingStartMeterMode !== undefined) setBillingStartMeterMode(data.billingStartMeterMode);
            if (data.billingStartMeter !== undefined) setBillingStartMeter(data.billingStartMeter);
            if (data.meterOffset !== undefined) setMeterOffset(data.meterOffset);
            if (data.overpowerThreshold !== undefined) setOverpowerThreshold(data.overpowerThreshold);
            if (data.isSoundEnabled !== undefined) setIsSoundEnabled(data.isSoundEnabled);
            if (data.isOverpowerAlertEnabled !== undefined) setIsOverpowerAlertEnabled(data.isOverpowerAlertEnabled);
            if (data.isOnlineOfflineAlertEnabled !== undefined) setIsOnlineOfflineAlertEnabled(data.isOnlineOfflineAlertEnabled);
            if (data.autoPruneDays !== undefined) setAutoPruneDays(data.autoPruneDays);
          } catch (e) {
            console.error("Error parsing cached settings:", e);
          }
        }
      }
    );
    return () => unsubscribe();
  }, []);

  // Subscribe to real-time power readings in Firestore
  useEffect(() => {
    setIsLoading(true);
    // Reduced to 50 to optimize Firestore read quota significantly!
    const q = query(
      collection(db, "power_readings"),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data: PowerReading[] = [];
        snapshot.forEach((doc) => {
          const docData = doc.data() as Omit<PowerReading, "id">;
          data.push({
            id: doc.id,
            ...docData,
          });
        });
        setReadings(data);
        setIsLoading(false);
        
        // Cache successful read
        localStorage.setItem("pzem_cached_readings", JSON.stringify(data));
      },
      (error: any) => {
        console.error("Firestore listening error:", error);
        setIsLoading(false);
        const isQuota = error?.message?.includes("Quota") || error?.message?.includes("quota") || error?.code === "resource-exhausted";
        if (isQuota) {
          setIsFirestoreQuotaExceeded(true);
          setFirestoreErrorMessage(error.message || "");
        }
        
        // Restore from cache
        const cached = localStorage.getItem("pzem_cached_readings");
        if (cached) {
          try {
            const data = JSON.parse(cached);
            setReadings(data);
          } catch (e) {
            console.error("Error parsing cached readings:", e);
          }
        }
      }
    );

    return () => unsubscribe();
  }, []);

  // Fetch history readings in Firestore based on filter (Optimized to skip if not on history tab and use single-fetch getDocs)
  useEffect(() => {
    if (activeTab !== "history") {
      setIsHistoryLoading(false);
      return;
    }

    const fetchHistory = async () => {
      setIsHistoryLoading(true);
      const now = new Date();
      
      // Today range (00:00:00 to 23:59:59.999)
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      
      // Yesterday range
      const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
      const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      
      // Last 7 days
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      // Last 1 month
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());

      let q: any;

      if (historyFilter === "today") {
        q = query(
          collection(db, "power_readings"),
          where("timestamp", ">=", todayStart),
          where("timestamp", "<=", todayEnd),
          orderBy("timestamp", "desc")
        );
      } else if (historyFilter === "yesterday") {
        q = query(
          collection(db, "power_readings"),
          where("timestamp", ">=", yesterdayStart),
          where("timestamp", "<=", yesterdayEnd),
          orderBy("timestamp", "desc")
        );
      } else if (historyFilter === "7days") {
        q = query(
          collection(db, "power_readings"),
          where("timestamp", ">=", sevenDaysAgo),
          orderBy("timestamp", "desc"),
          limit(300) // Reduced from 500 to optimize Firestore read quota
        );
      } else if (historyFilter === "1month") {
        q = query(
          collection(db, "power_readings"),
          where("timestamp", ">=", oneMonthAgo),
          orderBy("timestamp", "desc"),
          limit(500) // Reduced from 800 to optimize Firestore read quota
        );
      } else if (historyFilter === "billing") {
        const periods = getBillingPeriodsList();
        const selectedPeriod = periods[selectedBillingPeriodIndex];
        if (selectedPeriod) {
          q = query(
            collection(db, "power_readings"),
            where("timestamp", ">=", selectedPeriod.start),
            where("timestamp", "<=", selectedPeriod.end),
            orderBy("timestamp", "desc"),
            limit(500) // Reduced from 800 to optimize Firestore read quota
          );
        } else {
          q = query(
            collection(db, "power_readings"),
            orderBy("timestamp", "desc"),
            limit(300)
          );
        }
      } else {
        // "all"
        q = query(
          collection(db, "power_readings"),
          orderBy("timestamp", "desc"),
          limit(300) // Reduced from 500 to optimize Firestore read quota
        );
      }

      try {
        const snapshot = await getDocs(q);
        const data: PowerReading[] = [];
        snapshot.forEach((doc) => {
          const docData = doc.data() as Omit<PowerReading, "id">;
          data.push({
            id: doc.id,
            ...docData,
          });
        });
        setHistoryReadings(data);
        setIsHistoryLoading(false);
        
        // Cache successful read
        localStorage.setItem(`pzem_cached_history_${historyFilter}`, JSON.stringify(data));
      } catch (error: any) {
        console.error("Firestore history fetching error:", error);
        setIsHistoryLoading(false);
        const isQuota = error?.message?.includes("Quota") || error?.message?.includes("quota") || error?.code === "resource-exhausted";
        if (isQuota) {
          setIsFirestoreQuotaExceeded(true);
          setFirestoreErrorMessage(error.message || "");
        }
        
        // Restore from cache
        const cached = localStorage.getItem(`pzem_cached_history_${historyFilter}`);
        if (cached) {
          try {
            const data = JSON.parse(cached);
            setHistoryReadings(data);
          } catch (e) {
            console.error("Error parsing cached history readings:", e);
          }
        }
      }
    };

    fetchHistory();
  }, [activeTab, historyFilter, selectedBillingPeriodIndex, refreshCounter]);

  // Fetch the first reading of today to calculate daily consumption accurately (one-time fetch to save quota)
  useEffect(() => {
    const fetchTodayFirst = async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      
      const q = query(
        collection(db, "power_readings"),
        where("timestamp", ">=", todayStart),
        orderBy("timestamp", "asc"),
        limit(10) // Limit to 10 to find the first real non-simulated reading
      );

      try {
        const snapshot = await getDocs(q);
        let firstReal: PowerReading | null = null;
        snapshot.forEach((doc) => {
          const data = doc.data() as Omit<PowerReading, "id">;
          if (data.deviceId !== "esp32_pzem_sim" && !firstReal) {
            firstReal = {
              id: doc.id,
              ...data,
            };
          }
        });
        setTodayFirstReading(firstReal);
        if (firstReal) {
          localStorage.setItem("pzem_cached_today_first", JSON.stringify(firstReal));
        }
      } catch (error: any) {
        console.error("Error fetching today's first reading:", error);
        const isQuota = error?.message?.includes("Quota") || error?.message?.includes("quota") || error?.code === "resource-exhausted";
        if (isQuota) {
          setIsFirestoreQuotaExceeded(true);
          setFirestoreErrorMessage(error.message || "");
        }
        
        // Restore from cache
        const cached = localStorage.getItem("pzem_cached_today_first");
        if (cached) {
          try {
            const data = JSON.parse(cached);
            setTodayFirstReading(data);
          } catch (e) {
            console.error("Error parsing cached today first reading:", e);
          }
        }
      }
    };

    fetchTodayFirst();
  }, []);

  // Fetch the first reading of the current billing cycle (one-time fetch to save quota)
  useEffect(() => {
    const fetchBillingFirst = async () => {
      const period = getCurrentBillingPeriod();
      const q = query(
        collection(db, "power_readings"),
        where("timestamp", ">=", period.start),
        orderBy("timestamp", "asc"),
        limit(10) // Limit to 10 to find the first real non-simulated reading
      );

      try {
        const snapshot = await getDocs(q);
        let firstReal: PowerReading | null = null;
        snapshot.forEach((doc) => {
          const data = doc.data() as Omit<PowerReading, "id">;
          if (data.deviceId !== "esp32_pzem_sim" && !firstReal) {
            firstReal = {
              id: doc.id,
              ...data,
            };
          }
        });
        setBillingFirstReading(firstReal);
        if (firstReal) {
          localStorage.setItem("pzem_cached_billing_first", JSON.stringify(firstReal));
        }
      } catch (error: any) {
        console.error("Error fetching billing cycle first reading:", error);
        const isQuota = error?.message?.includes("Quota") || error?.message?.includes("quota") || error?.code === "resource-exhausted";
        if (isQuota) {
          setIsFirestoreQuotaExceeded(true);
          setFirestoreErrorMessage(error.message || "");
        }
        
        // Restore from cache
        const cached = localStorage.getItem("pzem_cached_billing_first");
        if (cached) {
          try {
            const data = JSON.parse(cached);
            setBillingFirstReading(data);
          } catch (e) {
            console.error("Error parsing cached billing first reading:", e);
          }
        }
      }
    };

    fetchBillingFirst();
  }, [getCurrentBillingPeriod().start.getTime()]);

  // Filter readings to only include real device data (removing simulated data)
  const filteredReadings = React.useMemo(() => {
    return readings.filter((r) => r.deviceId !== "esp32_pzem_sim");
  }, [readings]);

  // Helper to dynamically construct billing cycles for selection
  const getBillingPeriodsList = () => {
    const list = [];
    const now = new Date();
    
    for (let i = 0; i < 6; i++) {
      // Get middle of target month to find corresponding billing cycle
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 15);
      const period = getCurrentBillingPeriod(targetDate);
      
      const formatter = new Intl.DateTimeFormat("th-TH", { month: "short", year: "numeric" });
      const label = `รอบบิล ${formatter.format(period.end)} (${period.start.toLocaleDateString("th-TH", {day: "numeric", month: "numeric"})} - ${period.end.toLocaleDateString("th-TH", {day: "numeric", month: "numeric"})})`;
      
      list.push({
        label,
        start: period.start,
        end: period.end
      });
    }
    return list;
  };

  const getFilteredHistory = () => {
    const now = new Date();
    
    // Today range (00:00:00 to 23:59:59.999)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    // Yesterday range
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    
    // Last 7 days
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Last 1 month
    const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());

    const baseList = historyReadings.filter((r) => r.deviceId !== "esp32_pzem_sim");

    return baseList.filter((r) => {
      const rDate = getReadingDate(r.timestamp);
      if (historyFilter === "all") {
        return true;
      } else if (historyFilter === "today") {
        return rDate >= todayStart && rDate <= todayEnd;
      } else if (historyFilter === "yesterday") {
        return rDate >= yesterdayStart && rDate <= yesterdayEnd;
      } else if (historyFilter === "7days") {
        return rDate >= sevenDaysAgo;
      } else if (historyFilter === "1month") {
        return rDate >= oneMonthAgo;
      } else if (historyFilter === "billing") {
        const periods = getBillingPeriodsList();
        const selectedPeriod = periods[selectedBillingPeriodIndex];
        if (selectedPeriod) {
          return rDate >= selectedPeriod.start && rDate <= selectedPeriod.end;
        }
      }
      return true;
    });
  };

  const historyFilteredReadings = getFilteredHistory();

  // Apply Search Box filtering
  const searchedHistoryReadings = React.useMemo(() => {
    if (!historySearch.trim()) return historyFilteredReadings;
    const query = historySearch.toLowerCase().trim();
    return historyFilteredReadings.filter((r) => {
      const dateStr = getReadingDate(r.timestamp).toLocaleString().toLowerCase();
      const deviceIdStr = (r.deviceId || "real_pzem").toLowerCase();
      const powerStr = r.power.toString();
      const voltageStr = r.voltage.toString();
      const currentStr = r.current.toString();
      const energyStr = r.energy.toString();
      const freqStr = (r.frequency || 50.0).toString();
      const pfStr = (r.pf || 0.95).toString();

      return (
        dateStr.includes(query) ||
        deviceIdStr.includes(query) ||
        powerStr.includes(query) ||
        voltageStr.includes(query) ||
        currentStr.includes(query) ||
        energyStr.includes(query) ||
        freqStr.includes(query) ||
        pfStr.includes(query)
      );
    });
  }, [historyFilteredReadings, historySearch]);

  // Pagination calculation
  const totalHistoryPages = Math.max(1, Math.ceil(searchedHistoryReadings.length / historyItemsPerPage));
  const paginatedHistoryReadings = React.useMemo(() => {
    const startIndex = (historyPage - 1) * historyItemsPerPage;
    return searchedHistoryReadings.slice(startIndex, startIndex + historyItemsPerPage);
  }, [searchedHistoryReadings, historyPage]);

  // CSV Export Handler with Excel UTF-8 BOM support
  const handleExportCSV = () => {
    if (searchedHistoryReadings.length === 0) {
      alert("ไม่มีข้อมูลที่จะส่งออกในช่วงเวลาหรือคำค้นหานี้");
      return;
    }

    const csvHeaders = ["Timestamp", "Device ID", "Power (W)", "Voltage (V)", "Current (A)", "Energy (kWh)", "Frequency (Hz)", "Power Factor (PF)"];
    
    const csvRows = searchedHistoryReadings.map(r => {
      const dateStr = getReadingDate(r.timestamp).toLocaleString("th-TH").replace(/,/g, "");
      return [
        `"${dateStr}"`,
        `"${r.deviceId || "real_pzem"}"`,
        r.power,
        r.voltage,
        r.current,
        r.energy,
        r.frequency || 50.0,
        r.pf || 0.95
      ].join(",");
    });

    const csvContent = "\uFEFF" + [csvHeaders.join(","), ...csvRows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", url);
    link.setAttribute("download", `telemetry_export_${historyFilter}_${dateStamp}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const latestReading = filteredReadings[0] || null;

  const currentPower = latestReading ? latestReading.power : 0;
  const powerStatus = currentPower > overpowerThreshold 
    ? "danger" 
    : currentPower >= overpowerThreshold * 0.7 
      ? "warning" 
      : "safe";

  const powerTheme = {
    safe: {
      cardBg: isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm",
      badgeBg: "bg-emerald-500/10",
      badgeText: "text-emerald-600 dark:text-emerald-400",
      badgeBorder: "border-emerald-500/20",
      iconClass: "text-emerald-500 fill-emerald-500/25",
      bigZapColor: "text-emerald-500",
      unitColor: "text-emerald-500",
      numColor: "text-emerald-600 dark:text-emerald-400",
      statusLabel: "กำลังไฟฟ้าปกติ (ต่ำกว่า 70% ของเกณฑ์)",
      statusLabelColor: "text-emerald-600 dark:text-emerald-400",
    },
    warning: {
      cardBg: isDarkMode ? "bg-gradient-to-br from-zinc-900 to-amber-950/15 border-amber-500/30 shadow-xl shadow-amber-500/5" : "bg-gradient-to-br from-white to-amber-50/40 border-amber-500/30 shadow-sm shadow-amber-500/5",
      badgeBg: "bg-amber-500/10",
      badgeText: "text-amber-600 dark:text-amber-400",
      badgeBorder: "border-amber-500/20",
      iconClass: "text-amber-500 fill-amber-500/25 animate-pulse",
      bigZapColor: "text-amber-500",
      unitColor: "text-amber-500",
      numColor: "text-amber-500 dark:text-amber-400",
      statusLabel: "กำลังไฟฟ้าสูง (เตือน: เกิน 70% ของเกณฑ์)",
      statusLabelColor: "text-amber-600 dark:text-amber-400 font-medium",
    },
    danger: {
      cardBg: isDarkMode ? "bg-gradient-to-br from-zinc-900 to-rose-950/25 border-rose-500/40 shadow-xl shadow-rose-500/10 animate-pulse" : "bg-gradient-to-br from-white to-rose-50/40 border-rose-500/40 shadow-sm shadow-rose-500/10 animate-pulse",
      badgeBg: "bg-rose-500/10",
      badgeText: "text-rose-600 dark:text-rose-400",
      badgeBorder: "border-rose-500/20",
      iconClass: "text-rose-500 fill-rose-500/25 animate-bounce",
      bigZapColor: "text-rose-500",
      unitColor: "text-rose-500",
      numColor: "text-rose-500 dark:text-rose-400",
      statusLabel: `กำลังไฟฟ้าเกินจำกัด! (> ${overpowerThreshold} W)`,
      statusLabelColor: "text-rose-600 dark:text-rose-400 font-bold",
    }
  }[powerStatus];

  // Determine online status
  // If the last reading was received within 60 seconds, device is online
  const isOnline = (() => {
    if (!latestReading || !latestReading.timestamp) return false;
    
    let dateObj: Date;
    if (typeof latestReading.timestamp.toDate === "function") {
      dateObj = latestReading.timestamp.toDate();
    } else if (latestReading.timestamp instanceof Date) {
      dateObj = latestReading.timestamp;
    } else if (latestReading.timestamp.seconds) {
      dateObj = new Date(latestReading.timestamp.seconds * 1000);
    } else {
      dateObj = new Date(latestReading.timestamp);
    }

    const differenceInMs = new Date().getTime() - dateObj.getTime();
    return differenceInMs < 60000; // Less than 1 minute
  })();

  // Trigger sound alerts using Web Audio API
  const playWarningBeep = () => {
    if (!isSoundEnabled) return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const playBeep = (delay: number, frequency: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + duration);
        
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
      };

      playBeep(0, 880, 0.15); // A5 note
      playBeep(0.2, 880, 0.15);
      playBeep(0.4, 1200, 0.25); // Higher alarm note
    } catch (e) {
      console.warn("Audio Context blocked or failed:", e);
    }
  };

  const playInfoChime = () => {
    if (!isSoundEnabled) return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const playBeep = (delay: number, frequency: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + duration);
        
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
      };

      playBeep(0, 523.25, 0.1); // C5
      playBeep(0.12, 659.25, 0.15); // E5
    } catch (e) {
      console.warn("Audio Context failed:", e);
    }
  };

  const isFirstLoad = React.useRef(true);
  const soundEnabledRef = React.useRef(isSoundEnabled);

  useEffect(() => {
    soundEnabledRef.current = isSoundEnabled;
  }, [isSoundEnabled]);

  // Subscribe to real-time notifications in Firestore
  useEffect(() => {
    const q = query(
      collection(db, "notifications"),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data: any[] = [];
        snapshot.forEach((doc) => {
          data.push({
            id: doc.id,
            ...doc.data(),
          });
        });

        // Save to localStorage as fallback
        localStorage.setItem("pzem_notifications", JSON.stringify(data));

        // Play sounds and trigger native browser notifications for newly added documents after the initial load
        if (!isFirstLoad.current) {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added" && !change.doc.metadata.hasPendingWrites) {
              const notif = change.doc.data();
              // Only trigger if it is very recent (e.g. within the last 15 seconds)
              const ageMs = Date.now() - new Date(notif.timestamp).getTime();
              if (ageMs < 15000) {
                // 1. Play chime/beep if sound is enabled
                if (soundEnabledRef.current) {
                  if (notif.type === "overpower") {
                    playWarningBeep();
                  } else {
                    playInfoChime();
                  }
                }

                // 2. Trigger native OS/Browser background notification if granted (using Service Worker if available for reliable background execution)
                if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
                  try {
                    let emoji = "🔔";
                    if (notif.type === "online") emoji = "🟢";
                    if (notif.type === "offline") emoji = "🔴";
                    if (notif.type === "overpower") emoji = "⚠️";
                    if (notif.type === "overpower_normal") emoji = "✅";

                    const notificationTitle = `${emoji} ${notif.title}`;
                    const notificationOptions = {
                      body: notif.message,
                      icon: "./icon-512.jpg",
                      badge: "./icon-512.jpg",
                      vibrate: [200, 100, 200],
                      requireInteraction: notif.type === "overpower", // High priority alerts stay on screen
                      tag: `pzem_alert_${notif.type}` // Prevent clutter by replacement
                    };

                    if ("serviceWorker" in navigator) {
                      navigator.serviceWorker.ready.then((reg) => {
                        reg.showNotification(notificationTitle, notificationOptions);
                      }).catch(() => {
                        new Notification(notificationTitle, notificationOptions);
                      });
                    } else {
                      new Notification(notificationTitle, notificationOptions);
                    }
                  } catch (e) {
                    console.warn("Failed to trigger browser notification:", e);
                  }
                }
              }
            }
          });
        }

        setNotifications(data);
        isFirstLoad.current = false;
      },
      (error: any) => {
        console.error("Firestore notifications sync error:", error);
        const isQuota = error?.message?.includes("Quota") || error?.message?.includes("quota") || error?.code === "resource-exhausted";
        if (isQuota) {
          setIsFirestoreQuotaExceeded(true);
          setFirestoreErrorMessage(error.message || "");
        }
        
        // Restore from localStorage backup
        const cached = localStorage.getItem("pzem_notifications");
        if (cached) {
          try {
            const data = JSON.parse(cached);
            setNotifications(data);
          } catch (e) {
            console.error("Error parsing cached notifications:", e);
          }
        }
      }
    );

    return () => unsubscribe();
  }, []);

  // Add a new notification
  const addNotification = async (
    type: "online" | "offline" | "overpower" | "overpower_normal",
    title: string,
    message: string
  ) => {
    const newNotif = {
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
    };

    // Play local alerts immediately for instant user feedback
    if (type === "overpower") {
      playWarningBeep();
    } else {
      playInfoChime();
    }

    try {
      const newDocRef = doc(collection(db, "notifications"));
      await setDoc(newDocRef, newNotif);
    } catch (e) {
      console.error("Error writing notification to Firestore:", e);
    }
  };

  // Clear notifications
  const clearNotifications = async () => {
    try {
      if (notifications.length === 0) return;
      const batch = writeBatch(db);
      notifications.forEach((notif) => {
        const docRef = doc(db, "notifications", notif.id);
        batch.delete(docRef);
      });
      await batch.commit();
    } catch (e) {
      console.error("Error clearing notifications in Firestore:", e);
    }
  };

  // Mark all as read
  const markAllNotificationsAsRead = async () => {
    try {
      const unreadNotifs = notifications.filter((n) => !n.read);
      if (unreadNotifs.length === 0) return;

      const batch = writeBatch(db);
      unreadNotifs.forEach((notif) => {
        const docRef = doc(db, "notifications", notif.id);
        batch.update(docRef, { read: true });
      });
      await batch.commit();
    } catch (e) {
      console.error("Error marking notifications as read in Firestore:", e);
    }
  };

  // 1. Monitor online/offline state changes
  useEffect(() => {
    if (isLoading) return;

    // If there are no readings (e.g. database reset/cleared), don't trigger offline alerts
    if (!latestReading) {
      setPrevOnline(null);
      setIsOfflineBannerDismissed(true);
      return;
    }

    if (prevOnline === null) {
      setPrevOnline(isOnline);
      if (isOnline) {
        setIsOfflineBannerDismissed(false);
      }
      return;
    }

    if (isOnline) {
      setIsOfflineBannerDismissed(false);
    }

    if (isOnlineOfflineAlertEnabled) {
      if (isOnline && !prevOnline) {
        addNotification(
          "online",
          "อุปกรณ์กลับมาออนไลน์แล้ว 🟢",
          "อุปกรณ์ PZEM-004T กลับมาออนไลน์และรับส่งข้อมูลตามปกติ"
        );
      } else if (!isOnline && prevOnline) {
        addNotification(
          "offline",
          "อุปกรณ์ขาดการติดต่อ 🔴",
          "ตรวจไม่พบสัญญาณข้อมูลจากอุปกรณ์ PZEM-004T เกิน 60 วินาที"
        );
      }
    }
    setPrevOnline(isOnline);
  }, [isOnline, isLoading, isOnlineOfflineAlertEnabled, latestReading]);

  // 2. Monitor overpower / normal state transitions
  const currentPowerW = latestReading ? latestReading.power : 0;
  useEffect(() => {
    if (isLoading || !latestReading) return;
    if (!isOverpowerAlertEnabled) return;

    const isOver = currentPowerW > overpowerThreshold;
    if (isOver && !isOverpowerActive) {
      setIsOverpowerActive(true);
      addNotification(
        "overpower",
        "เตือน! กำลังไฟฟ้าเกินกำหนด ⚠️",
        `ตรวจพบการใช้งานกำลังไฟฟ้าสูงถึง ${currentPowerW.toLocaleString()} W (เกินค่าจำกัดสูงสุด ${overpowerThreshold.toLocaleString()} W)`
      );
    } else if (!isOver && isOverpowerActive) {
      setIsOverpowerActive(false);
      addNotification(
        "overpower_normal",
        "ระดับพลังงานไฟฟ้าปกติ ✅",
        `การใช้พลังงานไฟฟ้าลดลงมาอยู่ที่ ${currentPowerW.toLocaleString()} W (ต่ำกว่าเกณฑ์ความปลอดภัย)`
      );
    }
  }, [currentPowerW, overpowerThreshold, isOverpowerActive, isLoading, isOverpowerAlertEnabled]);

  // Clear Firestore Readings History
  const clearHistory = async () => {
    if (!window.confirm("คุณแน่ใจหรือไม่ว่าต้องการลบประวัติการวัดค่าพลังงานทั้งหมดในฐานข้อมูล?")) {
      return;
    }
    
    setIsClearing(true);
    try {
      const q = query(collection(db, "power_readings"));
      const snapshot = await getDocs(q);
      
      const batchSize = 100;
      let count = 0;
      
      while (count < snapshot.size) {
        const batch = writeBatch(db);
        const docsChunk = snapshot.docs.slice(count, count + batchSize);
        
        docsChunk.forEach((document) => {
          batch.delete(doc(db, "power_readings", document.id));
        });
        
        await batch.commit();
        count += batchSize;
      }
      
      alert("ลบข้อมูลประวัติเรียบร้อยแล้ว!");
    } catch (error) {
      console.error("Error clearing readings history:", error);
      alert("เกิดข้อผิดพลาดในการลบข้อมูล");
    } finally {
      setIsClearing(false);
    }
  };

  const [hasPrunedThisSession, setHasPrunedThisSession] = useState(false);

  // Auto pruning function
  const runAutoPruning = async (days: number) => {
    if (days <= 0) return;
    const thresholdDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    try {
      let hasMore = true;
      let totalDeleted = 0;
      let iterations = 0;
      
      while (hasMore && iterations < 5) {
        iterations++;
        const q = query(
          collection(db, "power_readings"),
          orderBy("timestamp", "asc"),
          limit(100)
        );
        const snapshot = await getDocs(q);
        
        const docsToDelete = snapshot.docs.filter(doc => {
          const data = doc.data();
          if (!data.timestamp) return false;
          const docDate = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
          return docDate < thresholdDate;
        });
        
        if (docsToDelete.length === 0) {
          hasMore = false;
          break;
        }
        
        const batch = writeBatch(db);
        docsToDelete.forEach((document) => {
          batch.delete(doc(db, "power_readings", document.id));
        });
        
        await batch.commit();
        totalDeleted += docsToDelete.length;
        
        if (snapshot.docs.length < 100 || docsToDelete.length < snapshot.docs.length) {
          hasMore = false;
        }
      }
      
      if (totalDeleted > 0) {
        console.log(`Auto-pruned ${totalDeleted} old documents older than ${days} days.`);
      }
    } catch (error) {
      console.error("Error during auto-pruning:", error);
    }
  };

  // Run auto-pruning once when database finishes loading
  useEffect(() => {
    if (!isLoading && autoPruneDays > 0 && !hasPrunedThisSession) {
      setHasPrunedThisSession(true);
      runAutoPruning(autoPruneDays);
    }
  }, [isLoading, autoPruneDays, hasPrunedThisSession]);

  // Get localized time string of last reading
  const getLastUpdatedText = () => {
    if (!latestReading || !latestReading.timestamp) return "ไม่มีข้อมูลการเชื่อมต่อ";
    
    let dateObj: Date;
    if (typeof latestReading.timestamp.toDate === "function") {
      dateObj = latestReading.timestamp.toDate();
    } else if (latestReading.timestamp instanceof Date) {
      dateObj = latestReading.timestamp;
    } else if (latestReading.timestamp.seconds) {
      dateObj = new Date(latestReading.timestamp.seconds * 1000);
    } else {
      dateObj = new Date(latestReading.timestamp);
    }

    return dateObj.toLocaleTimeString("th-TH") + " (" + dateObj.toLocaleDateString("th-TH") + ")";
  };

  // Get current billing period (starts 26th of last month, ends 25th of this month)
  const billingPeriod = getCurrentBillingPeriod();
  
  // Filter readings that are within the billing period
  const readingsInBillingCycle = filteredReadings.filter((r) => {
    const rDate = getReadingDate(r.timestamp);
    return rDate >= billingPeriod.start && rDate <= billingPeriod.end;
  });

  // Calculate actual energy consumed in the current billing cycle
  const currentMeterVal = latestReading ? (latestReading.energy + meterOffset) : 0;
  let billingKWh = billingStartMeterMode === "custom"
    ? Math.max(0, currentMeterVal - billingStartMeter)
    : getKWhConsumedInPeriod(readingsInBillingCycle);

  if (billingStartMeterMode === "auto" && latestReading && billingFirstReading) {
    if (latestReading.energy >= billingFirstReading.energy) {
      billingKWh = latestReading.energy - billingFirstReading.energy;
    } else {
      billingKWh = latestReading.energy; // handle PZEM reset
    }
  }

  // Progressive calculation of the current billing cycle cost
  const billingCostDetails = calculateProgressiveCost(
    billingKWh,
    ftRate,
    serviceFeeMode === "custom" ? customServiceFee : undefined,
    vatPercent
  );

  // Calculate today's readings, units consumed, and progressive cost
  const todayReadings = filteredReadings.filter((r) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const rDate = getReadingDate(r.timestamp);
    return rDate >= todayStart && rDate <= todayEnd;
  });

  const todayMaxCurrent = todayReadings.length > 0
    ? Math.max(...todayReadings.map((r) => r.current || 0))
    : (latestReading ? latestReading.current : 0);

  let todayKWh = getKWhConsumedInPeriod(todayReadings);
  if (latestReading && todayFirstReading) {
    if (latestReading.energy >= todayFirstReading.energy) {
      todayKWh = latestReading.energy - todayFirstReading.energy;
    } else {
      todayKWh = latestReading.energy; // handle PZEM reset
    }
  }

  // Calculate today's cost without service fee (as it is a daily metric)
  const todayCostDetails = calculateProgressiveCost(
    todayKWh,
    ftRate,
    0, // Service fee = 0 for daily energy cost
    vatPercent
  );
  
  // Projected Monthly cost assuming current continuous load
  const projectedMonthlyKWh = (currentPowerW / 1000) * 24 * 30; // continuous power load for 30 days
  const projectedCostDetails = calculateProgressiveCost(
    projectedMonthlyKWh,
    ftRate,
    serviceFeeMode === "custom" ? customServiceFee : undefined,
    vatPercent
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 flex flex-col lg:flex-row ${
      isDarkMode ? "bg-black text-zinc-100" : "bg-zinc-50 text-zinc-800"
    }`}>
      {/* ==================== LEFT SIDEBAR (DESKTOP) ==================== */}
      <aside className={`hidden lg:flex lg:flex-col lg:w-76 lg:h-screen lg:sticky lg:top-0 border-r shrink-0 transition-all duration-300 ${
        isDarkMode ? "bg-zinc-950 border-zinc-900 text-zinc-100" : "bg-white border-zinc-200 shadow-sm text-zinc-800"
      }`} id="desktop-sidebar">
        {/* Sidebar Header / Brand */}
        <div className="p-6 pb-4 border-b border-zinc-200/50 dark:border-zinc-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-black shadow-lg shadow-emerald-500/10 shrink-0">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h1 className={`text-lg font-extrabold tracking-tight flex flex-col ${isDarkMode ? "text-white" : "text-zinc-900"}`}>
                <span>PZEM-004T</span>
                <span className={`font-mono text-[9px] w-max mt-0.5 uppercase px-1.5 py-0.5 rounded border leading-none ${
                  isDarkMode ? "text-zinc-500 bg-zinc-900 border-zinc-800" : "text-zinc-500 bg-zinc-100 border-zinc-200"
                }`}>Realtime Monitor</span>
              </h1>
            </div>
          </div>
          <p className={`text-[11px] mt-3 leading-relaxed ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
            ระบบวิเคราะห์กำลังไฟฟ้าเรียลไทม์ผ่านบอร์ด ESP32 และเซนเซอร์ PZEM-004T + Firebase
          </p>
        </div>

        {/* Connection Status Badge (Sidebar version) */}
        <div className="px-6 py-4 border-b border-zinc-200/50 dark:border-zinc-800/50">
          <div className={`p-3 rounded-2xl border flex flex-col gap-2.5 transition-colors duration-300 ${
            isDarkMode ? "bg-zinc-900/40 border-zinc-900" : "bg-zinc-50 border-zinc-200/60"
          }`}>
            <div className="flex items-center justify-between">
              <p className={`text-[9px] uppercase tracking-widest font-black font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Firebase Sync</p>
              <p className="text-[10px] font-mono text-emerald-500 font-extrabold">CONNECTED</p>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className={`text-[10px] flex items-center gap-1 font-mono ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>
                <Clock className="w-3 h-3 text-indigo-500 dark:text-indigo-400" /> {latestReading ? getLastUpdatedText() : "ไม่มีข้อมูล"}
              </span>
              <div className="flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-zinc-400"}`} />
                <span className={`text-[9px] font-bold uppercase font-mono tracking-wider ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>
                  {isOnline ? "Online" : "Offline"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Navigation Links */}
        <nav className="flex-1 px-4 py-6 flex flex-col gap-1.5">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer border ${
              activeTab === "dashboard"
                ? isDarkMode
                  ? "bg-zinc-900 text-emerald-400 border-zinc-800 shadow-md"
                  : "bg-zinc-50 text-emerald-600 border-zinc-200 shadow-sm"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350"
            }`}
          >
            <Zap className={`w-4 h-4 transition-all duration-300 ${
              activeTab === "dashboard"
                ? "text-emerald-500 dark:text-emerald-400 fill-emerald-500/10 scale-110 drop-shadow-[0_0_6px_rgba(16,185,129,0.35)]"
                : "text-zinc-500"
            }`} />
            <span>แผงควบคุม (Dashboard)</span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer border ${
              activeTab === "history"
                ? isDarkMode
                  ? "bg-zinc-900 text-blue-400 border-zinc-800 shadow-md"
                  : "bg-zinc-50 text-blue-600 border-zinc-200 shadow-sm"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350"
            }`}
          >
            <Clock className={`w-4 h-4 transition-all duration-300 ${
              activeTab === "history"
                ? "text-blue-500 dark:text-blue-400 fill-blue-500/10 scale-110 drop-shadow-[0_0_6px_rgba(59,130,246,0.35)]"
                : "text-zinc-500"
            }`} />
            <span>ประวัติส่งค่า (History)</span>
          </button>

          <button
            onClick={() => setActiveTab("settings")}
            className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer border ${
              activeTab === "settings"
                ? isDarkMode
                  ? "bg-zinc-900 text-amber-400 border-zinc-800 shadow-md"
                  : "bg-zinc-50 text-amber-600 border-zinc-200 shadow-sm"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350"
            }`}
          >
            <Cpu className={`w-4 h-4 transition-all duration-300 ${
              activeTab === "settings"
                ? "text-amber-500 dark:text-amber-400 fill-amber-500/10 scale-110 drop-shadow-[0_0_6px_rgba(245,158,11,0.35)]"
                : "text-zinc-500"
            }`} />
            <span>ตั้งค่าระบบ (Settings)</span>
          </button>

          <button
            onClick={() => setActiveTab("about")}
            className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer border ${
              activeTab === "about"
                ? isDarkMode
                  ? "bg-zinc-900 text-teal-400 border-zinc-800 shadow-md"
                  : "bg-zinc-50 text-teal-600 border-zinc-200 shadow-sm"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350"
            }`}
          >
            <Info className={`w-4 h-4 transition-all duration-300 ${
              activeTab === "about"
                ? "text-teal-500 dark:text-teal-400 fill-teal-500/10 scale-110 drop-shadow-[0_0_6px_rgba(20,184,166,0.35)]"
                : "text-zinc-500"
            }`} />
            <span>เกี่ยวกับแอป (About)</span>
          </button>
        </nav>

        {/* Sidebar Footer Controls */}
        <div className="p-6 border-t border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between gap-3 relative">
          {/* Notification Button inside Sidebar */}
          <div className="relative flex-1">
            <button
              onClick={() => {
                setShowNotificationsDropdown(!showNotificationsDropdown);
                if (!showNotificationsDropdown) {
                  markAllNotificationsAsRead();
                }
              }}
              className={`w-full py-2.5 px-4 rounded-xl border transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer shadow-sm relative text-xs font-bold ${
                isDarkMode
                  ? "bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-850"
                  : "bg-white border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
              }`}
            >
              {unreadCount > 0 ? (
                <BellRing className="w-4 h-4 text-rose-500 fill-rose-500/10 animate-bounce shrink-0" />
              ) : (
                <Bell className="w-4 h-4 shrink-0" />
              )}
              <span>แจ้งเตือน</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 bg-rose-500 text-white text-[9px] font-black font-mono rounded-full border border-black shadow-lg">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotificationsDropdown && (
              <>
                <div 
                  className="fixed inset-0 z-45 cursor-default" 
                  onClick={() => setShowNotificationsDropdown(false)} 
                />
                <div className={`absolute bottom-14 left-0 w-80 rounded-3xl border shadow-2xl p-4 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200 ${
                  isDarkMode ? "bg-zinc-950 border-zinc-800 text-zinc-100" : "bg-white border-zinc-200 text-zinc-800"
                }`}>
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-800/50 mb-3">
                    <div className="flex items-center gap-1.5">
                      <Bell className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <h4 className="font-bold text-sm">แจ้งเตือนระบบ ({notifications.length})</h4>
                    </div>
                    <div className="flex gap-1.5">
                      {notifications.length > 0 && (
                        <button
                          onClick={clearNotifications}
                          className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded hover:opacity-80 transition-opacity cursor-pointer ${
                            isDarkMode ? "bg-zinc-900 text-zinc-400 hover:bg-zinc-850" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                          }`}
                        >
                          ล้างทั้งหมด
                        </button>
                      )}
                      <button 
                        onClick={() => setShowNotificationsDropdown(false)}
                        className={`text-[9px] font-bold px-2 py-0.5 rounded hover:opacity-80 transition-opacity cursor-pointer ${
                          isDarkMode ? "bg-zinc-900 text-zinc-500" : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        ปิด
                      </button>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                    {notifications.length === 0 ? (
                      <div className="text-center py-6 text-zinc-500">
                        <CheckCircle className="w-6 h-6 mx-auto text-zinc-600/60 mb-2" />
                        <p className="text-[11px]">ไม่มีรายการแจ้งเตือนใหม่</p>
                      </div>
                    ) : (
                      notifications.map((notif) => (
                        <div
                          key={notif.id}
                          className={`p-2.5 rounded-xl border transition-colors flex gap-2 items-start ${
                            notif.type === "overpower"
                              ? (isDarkMode ? "bg-rose-500/10 border-rose-500/20" : "bg-rose-50 border-rose-200")
                              : notif.type === "offline"
                              ? (isDarkMode ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200")
                              : notif.type === "online"
                              ? (isDarkMode ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200")
                              : (isDarkMode ? "bg-blue-500/5 border-blue-500/10" : "bg-blue-50 border-blue-100")
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {notif.type === "overpower" ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                            ) : notif.type === "offline" ? (
                              <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                            ) : notif.type === "online" ? (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Activity className="w-3.5 h-3.5 text-blue-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-[11px] font-bold leading-tight">{notif.title}</p>
                            <p className="text-[9px] mt-0.5 leading-normal opacity-85">{notif.message}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Theme switcher inside Sidebar */}
          <button
            onClick={toggleTheme}
            className={`p-2.5 rounded-xl border transition-all duration-300 flex items-center justify-center cursor-pointer shadow-sm ${
              isDarkMode
                ? "bg-zinc-900 border-zinc-800 text-amber-400 hover:text-amber-300 hover:bg-zinc-850"
                : "bg-white border-zinc-250 text-indigo-600 hover:text-indigo-500 hover:bg-zinc-50"
            }`}
            title={isDarkMode ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* ==================== MOBILE TOP HEADER ==================== */}
      <header className={`sticky top-0 z-50 backdrop-blur-md border-b lg:hidden transition-all duration-300 ${
        isDarkMode ? "bg-black/80 border-zinc-850" : "bg-white/85 border-zinc-200/80 shadow-sm"
      }`} id="mobile-header">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-black shadow-lg shadow-emerald-500/10">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h1 className={`text-sm font-black tracking-tight ${isDarkMode ? "text-white" : "text-zinc-900"}`}>
                PZEM-004T
              </h1>
              <p className={`text-[9px] leading-none opacity-65`}>Realtime Monitor</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${
              isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-zinc-100 border-zinc-200"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-zinc-400"}`} />
              <span className={`text-[8px] font-bold uppercase font-mono tracking-wider ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>

            <div className="relative">
              <button
                onClick={() => {
                  setShowNotificationsDropdown(!showNotificationsDropdown);
                  if (!showNotificationsDropdown) {
                    markAllNotificationsAsRead();
                  }
                }}
                className={`p-2 rounded-xl border transition-all duration-300 flex items-center justify-center cursor-pointer relative ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800 text-zinc-350" : "bg-white border-zinc-200 text-zinc-600"
                }`}
              >
                {unreadCount > 0 ? (
                  <BellRing className="w-4 h-4 text-rose-500 fill-rose-500/10 animate-bounce" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1 bg-rose-500 text-white text-[8px] font-black font-mono rounded-full">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotificationsDropdown && (
                <>
                  <div className="fixed inset-0 z-45" onClick={() => setShowNotificationsDropdown(false)} />
                  <div className={`absolute right-0 mt-2 w-72 rounded-2xl border shadow-xl p-3 z-50 animate-in fade-in duration-200 ${
                    isDarkMode ? "bg-zinc-950 border-zinc-800 text-zinc-100" : "bg-white border-zinc-200 text-zinc-800"
                  }`}>
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-850 mb-2">
                      <span className="text-xs font-bold">การแจ้งเตือน ({notifications.length})</span>
                      <button onClick={clearNotifications} className="text-[9px] text-zinc-500 font-mono">ล้าง</button>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin">
                      {notifications.length === 0 ? (
                        <p className="text-center py-4 text-[10px] text-zinc-500">ไม่มีแจ้งเตือน</p>
                      ) : (
                        notifications.map((notif) => (
                          <div key={notif.id} className="text-[10px] p-2 rounded-lg bg-zinc-900/40 text-left">
                            <p className="font-bold">{notif.title}</p>
                            <p className="text-[9px] opacity-85">{notif.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={toggleTheme}
              className={`p-2 rounded-xl border transition-all duration-300 flex items-center justify-center cursor-pointer ${
                isDarkMode ? "bg-zinc-900 border-zinc-800 text-amber-400" : "bg-white border-zinc-250 text-indigo-600"
              }`}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* ==================== MAIN CONTENT WRAPPER ==================== */}
      <div className="flex-1 flex flex-col min-w-0" id="main-content-scroller">
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
        
        {/* Real-time Status Alert Banners */}
        {(isFirestoreQuotaExceeded || isOverpowerActive || (!isOnline && isOnlineOfflineAlertEnabled && !isOfflineBannerDismissed) || (browserNotificationPermission !== "granted" && !isNotificationPromptDismissed)) && (
          <div className="space-y-3">
            {isFirestoreQuotaExceeded && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 rounded-3xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-amber-500/5"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-amber-500/15 text-amber-500 rounded-2xl border border-amber-500/20 shrink-0 mt-0.5">
                    <Database className="w-5 h-5 animate-pulse text-amber-500" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-amber-600 dark:text-amber-300">⚠️ โควตาดึงข้อมูลฐานข้อมูลรายวันเต็มขีดจำกัด (Database Quota Reached)</h4>
                    <p className={`text-xs mt-1 leading-relaxed ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>
                      เนื่องจากระบบใช้งานทรัพยากรบน Free Tier ถึงขีดจำกัดสูงสุด 50,000 อ่าน/วันแล้ว <span className="font-semibold text-amber-500 underline">ระบบได้สลับมาดึงข้อมูลสำรองล่าสุดจากอุปกรณ์ (Local Cache) และข้อมูลระบบจำลองอัตโนมัติ</span> ท่านยังสามารถทดสอบ ดูสถิติย้อนหลัง และตรวจสอบฟังก์ชันต่าง ๆ บนหน้าเว็บต่อได้ทันทีอย่างสมบูรณ์แบบ!
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    onClick={() => setIsFirestoreQuotaExceeded(false)}
                    className="p-1.5 rounded-full hover:bg-amber-500/15 transition-colors cursor-pointer text-amber-500"
                    title="ซ่อนคำเตือน"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {isOverpowerActive && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-3xl p-4 flex items-center justify-between gap-4 shadow-lg shadow-rose-500/5"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-rose-500/15 text-rose-500 rounded-2xl border border-rose-500/20 animate-pulse">
                    <AlertTriangle className="w-5 h-5 fill-rose-500/10 text-rose-500" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-rose-600 dark:text-rose-400">⚠️ ตรวจพบกำลังไฟฟ้าเกินกำหนด (Overpower Warning)</h4>
                    <p className={`text-xs mt-0.5 ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>
                      กำลังไฟฟ้าปัจจุบันใช้ไป <span className="font-bold font-mono text-rose-500">{currentPowerW.toLocaleString()} W</span> ซึ่งเกินขีดจำกัดความปลอดภัยที่กำหนดไว้ที่ <span className="font-bold font-mono text-zinc-800 dark:text-zinc-200">{overpowerThreshold.toLocaleString()} W</span>
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-rose-500/15 rounded-full text-[10px] font-black uppercase tracking-wider font-mono">
                  CRITICAL
                </span>
              </motion.div>
            )}
            
            {!isOnline && isOnlineOfflineAlertEnabled && !isOfflineBannerDismissed && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-3xl p-4 flex items-center justify-between gap-4 shadow-lg shadow-amber-500/5"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/15 text-amber-500 rounded-2xl border border-amber-500/20">
                    <ShieldAlert className="w-5 h-5 fill-amber-500/10 text-amber-500" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-amber-600 dark:text-amber-400">🔴 อุปกรณ์ออฟไลน์ (Device Disconnected)</h4>
                    <p className={`text-xs mt-0.5 ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>
                      ขาดการติดต่อรับส่งข้อมูลจากอุปกรณ์ PZEM-004T นานเกิน 60 วินาที กรุณาตรวจสอบสถานะบอร์ด ESP32 หรือการเชื่อมต่อ Wi-Fi
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2.5 py-1 bg-amber-500/15 rounded-full text-[10px] font-black uppercase tracking-wider font-mono">
                    OFFLINE
                  </span>
                  <button
                    onClick={() => setIsOfflineBannerDismissed(true)}
                    className="p-1.5 rounded-full hover:bg-amber-500/20 transition-colors cursor-pointer text-amber-600 dark:text-amber-400"
                    title="ปิดข้อความแจ้งเตือนนี้"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {browserNotificationPermission !== "granted" && !isNotificationPromptDismissed && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-teal-500/10 border border-teal-500/25 text-teal-600 dark:text-teal-400 rounded-3xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg shadow-teal-500/5"
              >
                <div className="flex items-start md:items-center gap-3">
                  <div className="p-2.5 bg-teal-500/15 text-teal-500 rounded-2xl border border-teal-500/20 shrink-0">
                    <Bell className="w-5 h-5 fill-teal-500/10 text-teal-500" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-teal-600 dark:text-teal-300">🔔 เปิดใช้งานแจ้งเตือนแบบพุช (Background Push Notifications)</h4>
                    <p className={`text-xs mt-0.5 ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>
                      ช่วยส่งแจ้งเตือนเข้าเครื่องคุณทันทีเมื่อระบบไฟเกิดอันตรายหรืออุปกรณ์หลุดการทำงาน <span className="font-semibold underline">แม้ในขณะที่คุณไม่ได้เข้าดูแอปนี้ หรือปิดหน้าจอมือถืออยู่</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto shrink-0 justify-between md:justify-end">
                  <button
                    onClick={requestNotificationPermission}
                    className="px-4 py-2 bg-teal-500 hover:bg-teal-650 text-black text-xs font-bold rounded-xl transition-all duration-300 cursor-pointer shadow-md text-center flex-1 md:flex-none"
                  >
                    เปิดรับการแจ้งเตือน
                  </button>
                  <button
                    onClick={() => {
                      setIsNotificationPromptDismissed(true);
                      localStorage.setItem("pzem_notif_prompt_dismissed", "true");
                    }}
                    className="p-1.5 rounded-full hover:bg-teal-500/15 transition-colors cursor-pointer text-teal-500 shrink-0"
                    title="ไม่ต้องแสดงข้อความนี้อีก"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* Desktop View Header Title & Quick Contextual Actions */}
        <div className="hidden lg:flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200/60 dark:border-zinc-800/40">
          <div>
            <h2 className="text-lg font-black tracking-tight uppercase flex items-center gap-2">
              {activeTab === "dashboard" && <Zap className="w-5 h-5 text-emerald-500 fill-emerald-500/10" />}
              {activeTab === "history" && <Clock className="w-5 h-5 text-blue-500 fill-blue-500/10" />}
              {activeTab === "settings" && <Cpu className="w-5 h-5 text-amber-500 fill-amber-500/10" />}
              {activeTab === "about" && <Info className="w-5 h-5 text-teal-500 fill-teal-500/10" />}
              <span>
                {activeTab === "dashboard" && "แผงควบคุมระบบ (Dashboard)"}
                {activeTab === "history" && "ประวัติส่งค่า (History Logs)"}
                {activeTab === "settings" && "ตั้งค่าอุปกรณ์ & อัตราค่าไฟ (Settings)"}
                {activeTab === "about" && "เกี่ยวกับระบบ (About Application)"}
              </span>
            </h2>
            <p className={`text-xs mt-1 ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
              {activeTab === "dashboard" && "ข้อมูลกระแสไฟฟ้า แรงดันไฟฟ้า กำลังไฟฟ้า และค่าไฟคำนวณแบบเรียลไทม์"}
              {activeTab === "history" && "ประวัติและกราฟข้อมูลย้อนหลังที่ได้รับจากเซนเซอร์ PZEM-004T ผ่าน ESP32"}
              {activeTab === "settings" && "ปรับแต่งอัตราค่าไฟฟ้า หน่วยตั้งต้น การแจ้งเตือน และจัดระเบียบระบบข้อมูล"}
              {activeTab === "about" && "คู่มือการต่อใช้งาน บอร์ด ESP32 ซอร์สโค้ด และข้อมูลอัตราค่าไฟฟ้าขั้นบันได"}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {activeTab === "history" && (
              <button
                onClick={clearHistory}
                disabled={isClearing}
                className="flex items-center justify-center gap-1.5 px-4 py-2 border border-rose-950 bg-rose-950/20 text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
              >
                {isClearing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                ล้างฐานข้อมูล (Clear Firebase)
              </button>
            )}

            {activeTab === "settings" && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono flex items-center gap-2 bg-zinc-100 dark:bg-black/40 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800/60 shadow-sm">
                <Coins className="w-3.5 h-3.5 text-emerald-400" />
                <span>อัตราก้าวหน้า + Ft: ฿{ftRate.toFixed(4)} / หน่วย</span>
              </div>
            )}
          </div>
        </div>

        {/* Control Center: Tab Switcher & Dynamic Context Actions */}
        <div className={`backdrop-blur-sm p-4 rounded-3xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors duration-300 lg:hidden ${
          isDarkMode ? "bg-zinc-900/60 border-zinc-800/80" : "bg-white border-zinc-200 shadow-sm"
        }`} id="iot-control-center">
          {/* Navigation Tabs */}
          <div className={`flex p-1 rounded-2xl border w-full lg:w-auto overflow-x-auto no-scrollbar transition-colors duration-300 ${
            isDarkMode ? "bg-black/40 border-zinc-800/60" : "bg-zinc-100 border-zinc-200"
          }`} id="main-nav-tabs">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "dashboard"
                  ? isDarkMode
                    ? "bg-zinc-800 text-emerald-400 border border-zinc-700/50 shadow-lg font-bold"
                    : "bg-white text-emerald-600 border border-zinc-200 shadow-sm font-bold"
                  : isDarkMode
                    ? "text-zinc-500 hover:text-zinc-300"
                    : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <Zap className={`w-4 h-4 transition-all duration-300 ${
                activeTab === "dashboard"
                  ? "text-emerald-500 dark:text-emerald-400 fill-emerald-500/25 scale-110 drop-shadow-[0_0_6px_rgba(16,185,129,0.35)]"
                  : "text-zinc-500"
              }`} />
              แผงควบคุม (Dashboard)
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "history"
                  ? isDarkMode
                    ? "bg-zinc-800 text-blue-400 border border-zinc-700/50 shadow-lg font-bold"
                    : "bg-white text-blue-600 border border-zinc-200 shadow-sm font-bold"
                  : isDarkMode
                    ? "text-zinc-500 hover:text-zinc-300"
                    : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <Clock className={`w-4 h-4 transition-all duration-300 ${
                activeTab === "history"
                  ? "text-blue-500 dark:text-blue-400 fill-blue-500/25 scale-110 drop-shadow-[0_0_6px_rgba(59,130,246,0.35)]"
                  : "text-zinc-500"
              }`} />
              ประวัติส่งค่า (History Logs)
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "settings"
                  ? isDarkMode
                    ? "bg-zinc-800 text-amber-400 border border-zinc-700/50 shadow-lg font-bold"
                    : "bg-white text-amber-600 border border-zinc-200 shadow-sm font-bold"
                  : isDarkMode
                    ? "text-zinc-500 hover:text-zinc-300"
                    : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <Cpu className={`w-4 h-4 transition-all duration-300 ${
                activeTab === "settings"
                  ? "text-amber-500 dark:text-amber-400 fill-amber-500/25 scale-110 drop-shadow-[0_0_6px_rgba(245,158,11,0.35)]"
                  : "text-zinc-500"
              }`} />
              ตั้งค่า & อุปกรณ์ (Settings)
            </button>
            <button
              onClick={() => setActiveTab("about")}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "about"
                  ? isDarkMode
                    ? "bg-zinc-800 text-teal-400 border border-zinc-700/50 shadow-lg font-bold"
                    : "bg-white text-teal-600 border border-zinc-200 shadow-sm font-bold"
                  : isDarkMode
                    ? "text-zinc-500 hover:text-zinc-300"
                    : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <Info className={`w-4 h-4 transition-all duration-300 ${
                activeTab === "about"
                  ? "text-teal-500 dark:text-teal-400 fill-teal-500/25 scale-110 drop-shadow-[0_0_6px_rgba(20,184,166,0.35)]"
                  : "text-zinc-500"
              }`} />
              เกี่ยวกับแอป (About)
            </button>
          </div>

          {/* Contextual Actions depending on selected tab */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">


            {/* Refresh history logs - Visible only on History tab */}
            {activeTab === "history" && (
              <button
                onClick={() => setRefreshCounter(prev => prev + 1)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 border border-blue-950 bg-blue-950/20 text-blue-400 hover:bg-blue-950/40 hover:text-blue-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                รีเฟรชข้อมูล (Refresh History)
              </button>
            )}

            {/* Clear database action - Visible only on History tab */}
            {activeTab === "history" && (
              <button
                onClick={clearHistory}
                disabled={isClearing}
                className="flex items-center justify-center gap-1.5 px-4 py-2 border border-rose-950 bg-rose-950/20 text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
              >
                {isClearing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                ล้างฐานข้อมูล (Clear Firebase)
              </button>
            )}

            {/* Current Tariff view - Visible only on Settings tab */}
            {activeTab === "settings" && (
              <div className="text-xs text-zinc-400 font-mono flex items-center gap-2 bg-black/40 px-4 py-2 rounded-xl border border-zinc-800/60">
                <Coins className="w-3.5 h-3.5 text-emerald-400" />
                <span>อัตราก้าวหน้า + Ft: ฿{ftRate.toFixed(4)} / หน่วย</span>
              </div>
            )}
          </div>
        </div>

        {/* -------------------- TAB CONTENT WRAPPERS -------------------- */}
        {/* -------------------- TAB 1: TELEMETRY & TRENDS (DASHBOARD) -------------------- */}
        {activeTab === "dashboard" && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
            id="tab-dashboard-content"
          >
            {/* Bento Grid layout for real-time electrical telemetry */}
            <div className="grid grid-cols-12 gap-4">
              
              {/* Card 1: Main Power Card - takes 6 columns and 2 rows equivalent */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`col-span-12 md:col-span-6 rounded-3xl p-6 md:p-8 flex flex-col justify-between relative overflow-hidden group border transition-all duration-300 ${powerTheme.cardBg}`}
                id="bento-power"
              >
                <div className={`absolute top-0 right-0 p-6 md:p-8 opacity-5 pointer-events-none transition-colors duration-300 ${powerTheme.bigZapColor}`}>
                  <Zap className="w-48 h-48" />
                </div>
                <div>
                  <span className={`px-3 py-1 ${powerTheme.badgeBg} ${powerTheme.badgeText} text-[10px] font-bold uppercase tracking-widest rounded-full border ${powerTheme.badgeBorder} flex items-center gap-1.5 w-fit shadow-sm transition-all duration-300`}>
                    <Zap className={`w-3.5 h-3.5 ${powerTheme.iconClass}`} /> Active Power Load
                  </span>
                  <h2 className={`mt-4 text-xs font-bold uppercase tracking-wider font-sans ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>กำลังไฟฟ้า ณ ขณะนี้ (Active Power)</h2>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className={`text-6xl md:text-7xl font-black tracking-tighter font-mono transition-colors duration-300 ${powerTheme.numColor}`}>
                      {latestReading ? (latestReading.power / 1000).toFixed(4) : "0.0000"}
                    </span>
                    <span className={`text-2xl font-bold font-mono transition-colors duration-300 ${powerTheme.unitColor}`}>kW</span>
                  </div>
                  {latestReading && (
                    <div className="flex justify-between items-center mt-1">
                      <span className={`text-xs font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
                        ≈ {latestReading.power.toFixed(1)} W
                      </span>
                      <span className={`text-[10px] font-sans ${powerTheme.statusLabelColor} transition-colors duration-300`}>
                        {powerTheme.statusLabel}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-4 mt-8">
                  <div className={`flex-1 rounded-2xl p-4 border transition-colors duration-300 ${
                    isDarkMode ? "bg-black/40 border-zinc-800/50" : "bg-zinc-50 border-zinc-200"
                  }`}>
                    <p className={`text-[10px] uppercase font-bold font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>กระแสไฟสูงสุดในวันนั้น</p>
                    <p className={`text-lg font-bold font-mono mt-1 ${isDarkMode ? "text-zinc-300" : "text-zinc-800"}`}>
                      {todayMaxCurrent.toFixed(3)} A
                    </p>
                  </div>
                  <div className={`flex-1 rounded-2xl p-4 border transition-colors duration-300 ${
                    isDarkMode ? "bg-black/40 border-zinc-800/50" : "bg-zinc-50 border-zinc-200"
                  }`}>
                    <p className={`text-[10px] uppercase font-bold font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>อัตรากำลังเฉลี่ย (Est)</p>
                    <p className={`text-lg font-bold font-mono mt-1 ${isDarkMode ? "text-zinc-300" : "text-zinc-800"}`}>
                      {latestReading ? (latestReading.power * 0.85 / 1000).toFixed(4) : "0.0000"} kW
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Card 2: Voltage Card */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className={`col-span-6 md:col-span-3 rounded-3xl p-6 flex flex-col justify-between group border relative overflow-hidden transition-all duration-300 ${
                  isDarkMode 
                    ? "bg-zinc-900 border-zinc-800 shadow-xl hover:border-blue-500/40" 
                    : "bg-white border-zinc-200 shadow-sm hover:border-blue-500/40"
                }`}
                id="bento-voltage"
              >
                <div className="absolute top-0 right-0 p-4 opacity-5 text-blue-500 pointer-events-none">
                  <Bolt className="w-24 h-24" />
                </div>
                <div>
                  <span className="px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-blue-500/20 flex items-center gap-1.5 w-fit shadow-sm">
                    <Bolt className="w-3.5 h-3.5 text-blue-500 fill-blue-500/25" /> AC VOLTAGE
                  </span>
                  <h2 className="text-zinc-500 mt-4 text-[10px] font-bold uppercase tracking-wider font-mono">แรงดันไฟฟ้า</h2>
                </div>
                <div className="my-4">
                  <div className="text-4xl font-mono font-bold text-blue-500">
                    {latestReading ? latestReading.voltage.toFixed(1) : "0.0"}
                    <span className={`text-lg ml-1 ${isDarkMode ? "text-zinc-650" : "text-zinc-400"}`}>V</span>
                  </div>
                </div>
                <div className="w-full">
                  <div className={`w-full h-1.5 rounded-full overflow-hidden ${isDarkMode ? "bg-zinc-950" : "bg-zinc-100"}`}>
                    <div 
                      className="h-full bg-blue-500 transition-all duration-500" 
                      style={{ width: `${Math.min(100, Math.max(10, ((latestReading?.voltage || 220) / 260) * 100))}%` }}
                    />
                  </div>
                  <p className={`text-[10px] mt-1.5 font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>ช่วงแรงดันที่เหมาะสม (220V ±10%)</p>
                </div>
              </motion.div>

              {/* Card 3: Current Card */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className={`col-span-6 md:col-span-3 rounded-3xl p-6 flex flex-col justify-between group border relative overflow-hidden transition-all duration-300 ${
                  isDarkMode 
                    ? "bg-zinc-900 border-zinc-800 shadow-xl hover:border-amber-500/40" 
                    : "bg-white border-zinc-200 shadow-sm hover:border-amber-500/40"
                }`}
                id="bento-current"
              >
                <div className="absolute top-0 right-0 p-4 opacity-5 text-amber-500 pointer-events-none">
                  <Activity className="w-24 h-24" />
                </div>
                <div>
                  <span className="px-2.5 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-amber-500/20 flex items-center gap-1.5 w-fit shadow-sm">
                    <Activity className="w-3.5 h-3.5 text-amber-500" /> AC CURRENT
                  </span>
                  <h2 className="text-zinc-500 mt-4 text-[10px] font-bold uppercase tracking-wider font-mono">กระแสไฟฟ้า</h2>
                </div>
                <div className="my-4">
                  <div className="text-4xl font-mono font-bold text-amber-500">
                    {latestReading ? latestReading.current.toFixed(3) : "0.000"}
                    <span className={`text-lg ml-1 ${isDarkMode ? "text-zinc-650" : "text-zinc-400"}`}>A</span>
                  </div>
                </div>
                <div className="w-full">
                  <div className={`w-full h-1.5 rounded-full overflow-hidden ${isDarkMode ? "bg-zinc-950" : "bg-zinc-100"}`}>
                    <div 
                      className="h-full bg-amber-500 transition-all duration-500" 
                      style={{ width: `${Math.min(100, Math.max(5, ((latestReading?.current || 0) / 10) * 100))}%` }}
                    />
                  </div>
                  <p className={`text-[10px] mt-1.5 font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>โหลดแอมแปร์ของอุปกรณ์สะสม</p>
                </div>
              </motion.div>

              {/* Card 4: Cumulative Energy (Total Consumption) - Colored Bento Card */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="col-span-12 md:col-span-4 bg-gradient-to-tr from-emerald-600 to-teal-600 text-white rounded-3xl p-6 flex flex-col justify-between shadow-xl relative overflow-hidden"
                id="bento-energy"
              >
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                  <Cpu className="w-32 h-32" />
                </div>
                <div>
                  <div className="flex justify-between items-start">
                    <span className="px-2.5 py-1 bg-white/20 text-white text-[10px] font-bold uppercase tracking-widest rounded-full border border-white/15 flex items-center gap-1.5 shadow-sm">
                      <Cpu className="w-3.5 h-3.5 fill-white/25 text-white" /> Total Energy Counter
                    </span>
                    {meterOffset !== 0 && (
                      <span className="text-[9px] font-mono font-bold bg-black/30 text-emerald-200 px-2 py-0.5 rounded border border-white/10">
                        CALIBRATED
                      </span>
                    )}
                  </div>
                  <h3 className="text-5xl font-black mt-6 tracking-tight font-mono">
                    {latestReading ? (latestReading.energy + meterOffset).toFixed(4) : "0.0000"}
                  </h3>
                  <p className="text-xs font-bold uppercase tracking-wider opacity-85 mt-1 font-mono">ตัวเลขมิเตอร์สะสม (kWh)</p>
                </div>
                <div className="flex justify-between items-center text-[11px] border-t border-white/20 pt-4 mt-6">
                  <span className="opacity-80">
                    {meterOffset !== 0
                      ? `เซนเซอร์: ${latestReading ? latestReading.energy.toFixed(4) : "0"} | ชดเชย: ${meterOffset >= 0 ? "+" : ""}${meterOffset.toFixed(4)}`
                      : "เก็บข้อมูลเข้า Firebase สะสมตลอดกาล"
                    }
                  </span>
                  <span className="bg-black/20 px-2.5 py-0.5 rounded font-bold font-mono">PZEM EEPROM</span>
                </div>
              </motion.div>

              {/* Card 5: Frequency Card */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
                className={`col-span-6 md:col-span-4 rounded-3xl p-6 flex flex-col justify-between border relative overflow-hidden transition-all duration-300 ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
                }`}
                id="bento-frequency"
              >
                <div className="absolute top-0 right-0 p-4 opacity-5 text-violet-500 pointer-events-none">
                  <Waves className="w-24 h-24" />
                </div>
                <div>
                  <span className="px-2.5 py-1 bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-violet-500/20 flex items-center gap-1.5 w-fit shadow-sm">
                    <Waves className="w-3.5 h-3.5 text-violet-500 fill-violet-500/25" /> FREQUENCY
                  </span>
                  <h2 className="text-zinc-500 mt-4 text-[10px] font-bold uppercase tracking-wider font-mono">ความถี่สัญญาณ AC</h2>
                </div>
                <div className="my-4">
                  <div className="text-3xl font-mono font-bold text-violet-500">
                    {latestReading ? latestReading.frequency.toFixed(1) : "0.0"}{" "}
                    <span className={`text-sm ${isDarkMode ? "text-zinc-550" : "text-zinc-400"}`}>Hz</span>
                  </div>
                </div>
                <div className={`text-[10px] font-mono flex items-center gap-1.5 px-2.5 py-1 rounded-lg border w-fit ${
                  isDarkMode ? "text-emerald-400 bg-emerald-500/5 border-emerald-500/10" : "text-emerald-600 bg-emerald-50 border-emerald-200"
                }`}>
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
                  ค่าปกติ (Nominal Range)
                </div>
              </motion.div>

              {/* Card 6: Power Factor Card */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.25 }}
                className={`col-span-6 md:col-span-4 rounded-3xl p-6 flex flex-col justify-between border relative overflow-hidden transition-all duration-300 ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
                }`}
                id="bento-pf"
              >
                <div className="absolute top-0 right-0 p-4 opacity-5 text-rose-500 pointer-events-none">
                  <Percent className="w-24 h-24" />
                </div>
                <div>
                  <span className="px-2.5 py-1 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-rose-500/20 flex items-center gap-1.5 w-fit shadow-sm">
                    <Percent className="w-3.5 h-3.5 text-rose-500 fill-rose-500/25" /> POWER FACTOR
                  </span>
                  <h2 className="text-zinc-500 mt-4 text-[10px] font-bold uppercase tracking-wider font-mono">ตัวประกอบกำลังไฟฟ้า</h2>
                </div>
                <div className="my-4">
                  <div className="text-3xl font-mono font-bold text-rose-500">
                    {latestReading ? latestReading.pf.toFixed(2) : "0.00"}{" "}
                    <span className={`text-sm ${isDarkMode ? "text-zinc-550" : "text-zinc-400"}`}>PF</span>
                  </div>
                </div>
                <div className={`text-[10px] font-mono ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                  {latestReading && latestReading.pf >= 0.9 ? "โหลดต้านทาน (Resistive)" : "โหลดเหนี่ยวนำ (Inductive)"}
                </div>
              </motion.div>

            </div>

            {/* Cost breakdown cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" id="dashboard-costs">
              
              {/* Today's Cost and Units Card */}
              <div className={`p-6 rounded-3xl flex flex-col justify-between border transition-all duration-300 ${
                isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
              }`}>
                <div>
                  <div className="flex justify-between items-start">
                    <span className="px-2.5 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-amber-500/20 w-fit font-mono flex items-center gap-1.5 shadow-sm">
                      <Coins className="w-3.5 h-3.5 text-amber-500 fill-amber-500/25" /> TODAY'S ENERGY & COST
                    </span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors duration-300 ${
                      isDarkMode ? "text-zinc-500 bg-black/30 border-zinc-800" : "text-zinc-500 bg-zinc-100 border-zinc-200"
                    }`}>
                      วันนี้ (00:00 - 24:00)
                    </span>
                  </div>
                  <span className={`text-xs mt-3 block font-medium ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                    ปริมาณการใช้ไฟฟ้าและค่าไฟของวันนี้ ({new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })})
                  </span>
                </div>
                
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-3xl font-extrabold text-amber-500 font-mono tracking-tight">
                      ฿{todayCostDetails.totalCost.toFixed(2)}
                    </h3>
                    <span className={`text-xs font-mono font-bold transition-colors ${isDarkMode ? "text-amber-500/90" : "text-amber-600"}`}>
                      ใช้ไป {todayKWh.toFixed(4)} kWh
                    </span>
                  </div>

                  {/* Toggle Button for breakdown */}
                  <div className={`pt-2 border-t flex justify-between items-center ${isDarkMode ? "border-zinc-800/40" : "border-zinc-100"}`}>
                    <button
                      onClick={() => setShowTodayBreakdown(!showTodayBreakdown)}
                      className="text-[11px] text-amber-500 hover:text-amber-600 font-semibold flex items-center gap-1 cursor-pointer select-none"
                    >
                      {showTodayBreakdown ? "ซ่อนรายละเอียดค่าไฟวันนี้ ▴" : "แสดงรายละเอียดค่าไฟวันนี้ ▾"}
                    </button>
                    <span className={`text-[10px] font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>รวม Ft + VAT {vatPercent}%</span>
                  </div>

                  {showTodayBreakdown && (
                    <div className={`mt-2 pt-2 text-[11px] space-y-1.5 font-mono p-3 rounded-xl border animate-in fade-in duration-200 ${
                      isDarkMode ? "bg-black/40 text-zinc-400 border-zinc-800/60" : "bg-zinc-50 text-zinc-600 border-zinc-200"
                    }`}>
                      <div className={`text-[9px] font-bold uppercase tracking-wider pb-1 border-b ${isDarkMode ? "text-zinc-500 border-zinc-800/40" : "text-zinc-400 border-zinc-200"}`}>แจกแจงค่าไฟวันนี้ (Today Cost)</div>
                      <div className="flex justify-between py-0.5">
                        <span className={isDarkMode ? "text-zinc-500" : "text-zinc-400"}>ค่าไฟฐาน (Base):</span>
                        <span className={isDarkMode ? "text-zinc-300" : "text-zinc-700"}>฿{todayCostDetails.baseCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className={isDarkMode ? "text-zinc-500" : "text-zinc-400"}>ค่า Ft (฿{todayCostDetails.ftRate.toFixed(4)}/หน่วย):</span>
                        <span className={isDarkMode ? "text-zinc-300" : "text-zinc-700"}>฿{todayCostDetails.ftCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className={isDarkMode ? "text-zinc-500" : "text-zinc-400"}>ภาษี VAT {vatPercent}%:</span>
                        <span className={isDarkMode ? "text-zinc-300" : "text-zinc-700"}>฿{todayCostDetails.vat.toFixed(2)}</span>
                      </div>
                      <div className={`border-t mt-1 pt-1 flex justify-between font-bold ${isDarkMode ? "border-zinc-800/60 text-zinc-300" : "border-zinc-200 text-zinc-800"}`}>
                        <span>รวมค่าไฟสะสมวันนี้:</span>
                        <span className="text-amber-500">฿{todayCostDetails.totalCost.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Billing Cycle cost card */}
              <div className={`p-6 rounded-3xl flex flex-col justify-between border transition-all duration-300 ${
                isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
              }`}>
                <div>
                  <div className="flex justify-between items-start">
                    <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-emerald-500/20 w-fit font-mono flex items-center gap-1.5 shadow-sm">
                      <Calendar className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500/25" /> BILLING CYCLE COST (26 - 25)
                    </span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors duration-300 ${
                      isDarkMode ? "text-zinc-500 bg-black/30 border-zinc-800" : "text-zinc-500 bg-zinc-100 border-zinc-200"
                    }`}>
                      ตัดรอบ 25 ของเดือน
                    </span>
                  </div>
                  <span className={`text-xs mt-3 block font-medium ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                    ค่าไฟรอบบิลปัจจุบัน ({billingPeriod.start.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} - {billingPeriod.end.toLocaleDateString("th-TH", { day: "numeric", month: "short" })})
                  </span>
                </div>
                
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-3xl font-extrabold text-emerald-500 font-mono tracking-tight">
                      ฿{billingCostDetails.totalCost.toFixed(2)}
                    </h3>
                    <span className={`text-xs font-mono font-bold ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                      ใช้ไป {billingKWh.toFixed(4)} kWh
                    </span>
                  </div>

                  {/* Toggle Button for breakdown */}
                  <div className={`pt-2 border-t flex justify-between items-center ${isDarkMode ? "border-zinc-800/40" : "border-zinc-100"}`}>
                    <button
                      onClick={() => setShowStepBreakdown(!showStepBreakdown)}
                      className="text-[11px] text-emerald-500 hover:text-emerald-600 font-semibold flex items-center gap-1 cursor-pointer select-none"
                    >
                      {showStepBreakdown ? "ซ่อนรายละเอียดคิดค่าไฟแบบก้าวหน้า ▴" : "แสดงรายละเอียดคิดค่าไฟแบบก้าวหน้า ▾"}
                    </button>
                    <span className={`text-[10px] font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>อัตราประเภท 1.1</span>
                  </div>

                  {showStepBreakdown && (
                    <div className={`mt-2 pt-2 text-[11px] space-y-1.5 font-mono p-3 rounded-xl border animate-in fade-in duration-200 ${
                      isDarkMode ? "bg-black/40 text-zinc-400 border-zinc-800/60" : "bg-zinc-50 text-zinc-600 border-zinc-200"
                    }`}>
                      <div className={`text-[9px] font-bold uppercase tracking-wider pb-1 border-b ${isDarkMode ? "text-zinc-500 border-zinc-800/40" : "text-zinc-400 border-zinc-200"}`}>การคำนวณขั้นบันได (Energy Steps)</div>
                      {billingCostDetails.breakdown.length === 0 ? (
                        <p className="text-[10px] text-zinc-500 italic py-1">ยังไม่มีหน่วยไฟฟ้าใช้ในรอบบิลนี้</p>
                      ) : (
                        billingCostDetails.breakdown.map((step, idx) => (
                          <div key={idx} className="flex justify-between py-0.5">
                            <span className={isDarkMode ? "text-zinc-500" : "text-zinc-400"}>{step.name}:</span>
                            <span className={`font-semibold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>{step.units} หน่วย × ฿{step.rate.toFixed(4)} = ฿{step.cost.toFixed(2)}</span>
                          </div>
                        ))
                      )}
                      
                      <div className={`border-t mt-1 pt-1 space-y-0.5 text-[10px] ${isDarkMode ? "border-zinc-800/60 text-zinc-500" : "border-zinc-200 text-zinc-500"}`}>
                        <div className="flex justify-between">
                          <span>ค่าพลังงานไฟฟ้ารวม (Base):</span>
                          <span className={isDarkMode ? "text-zinc-400" : "text-zinc-700"}>฿{billingCostDetails.baseCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>ค่าบริการรายเดือน (Service Fee):</span>
                          <span className={isDarkMode ? "text-zinc-400" : "text-zinc-700"}>฿{billingCostDetails.serviceFee.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>ค่า Ft (฿{billingCostDetails.ftRate.toFixed(4)}/หน่วย):</span>
                          <span className={isDarkMode ? "text-zinc-400" : "text-zinc-700"}>฿{billingCostDetails.ftCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>ภาษีมูลค่าเพิ่ม VAT {vatPercent}%:</span>
                          <span className={isDarkMode ? "text-zinc-400" : "text-zinc-700"}>฿{billingCostDetails.vat.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Projected monthly cost */}
              <div className={`p-6 rounded-3xl flex flex-col justify-between border transition-all duration-300 ${
                isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
              }`}>
                <div>
                  <span className="px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-blue-500/20 w-fit font-mono flex items-center gap-1.5 shadow-sm">
                    <TrendingUp className="w-3.5 h-3.5 text-blue-500 fill-blue-500/25" /> PROJECTED MONTHLY COST
                  </span>
                  <span className={`text-xs mt-3 block font-medium ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>ค่าไฟเฉลี่ยคาดการณ์ต่อเดือน (คำนวณแบบก้าวหน้า)</span>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className={`text-3xl font-extrabold font-mono tracking-tight ${isDarkMode ? "text-white" : "text-zinc-800"}`}>
                      ฿{projectedCostDetails.totalCost.toFixed(2)}
                    </h3>
                    <span className={`text-xs font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
                      คาดการณ์ {projectedMonthlyKWh.toFixed(2)} kWh
                    </span>
                  </div>
                  <div className={`pt-2 border-t text-[10px] leading-relaxed font-mono ${
                    isDarkMode ? "border-zinc-800/40 text-zinc-500" : "border-zinc-150 text-zinc-400"
                  }`}>
                    ประเมินจากการเปิดใช้โหลดไฟ {(currentPowerW / 1000).toFixed(4)} kW ({currentPowerW.toFixed(1)}W) ต่อเนื่อง 24 ชม. เป็นเวลา 30 วัน รวมค่าบริการ ค่า Ft และภาษี VAT แล้ว
                  </div>
                </div>
              </div>

            </div>

            {/* Chart Section */}
            <div className="w-full">
              <ChartSection
                data={searchedHistoryReadings}
                isDarkMode={isDarkMode}
                historyFilter={historyFilter}
                setHistoryFilter={setHistoryFilter}
                selectedBillingPeriodIndex={selectedBillingPeriodIndex}
                setSelectedBillingPeriodIndex={setSelectedBillingPeriodIndex}
                getBillingPeriodsList={getBillingPeriodsList}
              />
            </div>
          </motion.div>
        )}

        {/* -------------------- TAB 2: HISTORICAL LOGS VIEW -------------------- */}
        {activeTab === "history" && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
            id="tab-history-content"
          >
            {/* History Date & Billing Filters */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-950/40 p-4 rounded-3xl border border-zinc-800/60 shadow-lg">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setHistoryFilter("all")}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    historyFilter === "all"
                      ? "bg-blue-500 text-black shadow-lg shadow-blue-500/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  ทั้งหมด
                </button>
                <button
                  onClick={() => setHistoryFilter("today")}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    historyFilter === "today"
                      ? "bg-blue-500 text-black shadow-lg shadow-blue-500/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  วันนี้
                </button>
                <button
                  onClick={() => setHistoryFilter("yesterday")}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    historyFilter === "yesterday"
                      ? "bg-blue-500 text-black shadow-lg shadow-blue-500/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  เมื่อวาน
                </button>
                <button
                  onClick={() => setHistoryFilter("7days")}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    historyFilter === "7days"
                      ? "bg-blue-500 text-black shadow-lg shadow-blue-500/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  7 วันล่าสุด
                </button>
                <button
                  onClick={() => setHistoryFilter("1month")}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    historyFilter === "1month"
                      ? "bg-blue-500 text-black shadow-lg shadow-blue-500/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  1 เดือนล่าสุด
                </button>
                <button
                  onClick={() => setHistoryFilter("billing")}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                    historyFilter === "billing"
                      ? "bg-blue-500 text-black shadow-lg shadow-blue-500/10"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  เลือกตามรอบบิล
                </button>
              </div>

              {/* Billing Cycle Dropdown */}
              {historyFilter === "billing" && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-500 font-bold font-mono">เลือกรอบบิล:</span>
                  <select
                    value={selectedBillingPeriodIndex}
                    onChange={(e) => setSelectedBillingPeriodIndex(parseInt(e.target.value))}
                    className="bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono cursor-pointer"
                  >
                    {getBillingPeriodsList().map((period, idx) => (
                      <option key={idx} value={idx}>
                        {period.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* History Statistics Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={`p-5 rounded-3xl flex items-center gap-4 border transition-colors duration-300 ${
                isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
              }`}>
                <div className="p-3 bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded-2xl border border-blue-500/25 shadow-inner">
                  <Clock className="w-5 h-5 fill-blue-500/20" />
                </div>
                <div>
                  <p className={`text-[10px] uppercase font-bold font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>จำนวนบันทึกตามเงื่อนไข</p>
                  <p className={`text-xl font-bold font-mono mt-0.5 ${isDarkMode ? "text-zinc-200" : "text-zinc-800"}`}>{historyFilteredReadings.length} Packets</p>
                </div>
              </div>
              <div className={`p-5 rounded-3xl flex items-center gap-4 border transition-colors duration-300 ${
                isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
              }`}>
                <div className="p-3 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-2xl border border-emerald-500/25 shadow-inner">
                  <Zap className="w-5 h-5 fill-emerald-500/20" />
                </div>
                <div>
                  <p className={`text-[10px] uppercase font-bold font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>กำลังไฟสูงสุด (Peak Power)</p>
                  <p className="text-xl font-bold font-mono text-emerald-500 mt-0.5">
                    {historyFilteredReadings.length > 0 ? (Math.max(...historyFilteredReadings.map(r => r.power)) / 1000).toFixed(4) : "0.0000"} kW
                  </p>
                </div>
              </div>
              <div className={`p-5 rounded-3xl flex items-center gap-4 border transition-colors duration-300 ${
                isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
              }`}>
                <div className="p-3 bg-violet-500/15 text-violet-600 dark:text-violet-400 rounded-2xl border border-violet-500/25 shadow-inner">
                  <TrendingUp className="w-5 h-5 fill-violet-500/20" />
                </div>
                <div>
                  <p className={`text-[10px] uppercase font-bold font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>แรงดันไฟเฉลี่ย (Avg Voltage)</p>
                  <p className="text-xl font-bold font-mono text-violet-500 mt-0.5">
                    {historyFilteredReadings.length > 0 ? (historyFilteredReadings.reduce((sum, r) => sum + r.voltage, 0) / historyFilteredReadings.length).toFixed(1) : "0.0"} V
                  </p>
                </div>
              </div>
            </div>

            {/* Live Data Feed Logs Table */}
            <div className={`border rounded-3xl p-6 transition-all duration-300 shadow-xl ${
              isDarkMode ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-zinc-200 shadow-sm"
            }`} id="history-container">
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div className="text-left">
                  <h3 className={`font-semibold text-base ${isDarkMode ? "text-white" : "text-zinc-800"}`}>บันทึกข้อมูลย้อนหลัง (Telemetry History Logs)</h3>
                  <p className={`text-xs mt-0.5 ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>แสดงประวัติสัญญาณรับค่าไฟฟ้าตามตัวเลือกตัวกรองและการค้นหาในปัจจุบัน</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-mono font-bold px-3 py-1.5 rounded-xl border shrink-0 ${
                    isDarkMode ? "bg-black/40 text-zinc-400 border-zinc-800" : "bg-zinc-100 text-zinc-600 border-zinc-200"
                  }`}>
                    กรองแล้ว {searchedHistoryReadings.length} / {historyFilteredReadings.length}
                  </span>
                  
                  <button
                    onClick={handleExportCSV}
                    className={`px-4 py-1.5 text-xs font-bold rounded-xl border flex items-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-sm ${
                      isDarkMode 
                        ? "bg-zinc-800/40 border-zinc-700/50 hover:bg-zinc-800 text-emerald-400" 
                        : "bg-white border-zinc-200 hover:bg-zinc-50 text-emerald-600"
                    }`}
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                    ส่งออก CSV (.csv)
                  </button>
                </div>
              </div>

              {/* Search input bar */}
              <div className="mb-6">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="พิมพ์เพื่อค้นหาข้อมูล (เวลา, วันที่, อุปกรณ์, กำลังไฟ W, โวลต์ V, กระแส A, พลังงานสะสม...)"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className={`w-full pl-10 pr-4 py-2.5 text-xs rounded-xl border focus:outline-none focus:ring-2 transition-all text-left ${
                      isDarkMode 
                        ? "bg-black/40 border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:ring-zinc-700 focus:border-zinc-700" 
                        : "bg-white border-zinc-200 text-zinc-800 placeholder-zinc-400 focus:ring-emerald-500 focus:border-emerald-500 shadow-inner"
                    }`}
                  />
                </div>
              </div>

              {isHistoryLoading ? (
                <div className={`py-24 flex justify-center items-center gap-2 font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
                  <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
                  <span className="text-sm">LOG_STREAMING_ACTIVE...</span>
                </div>
              ) : searchedHistoryReadings.length === 0 ? (
                <div className={`text-center py-24 border border-dashed rounded-3xl ${
                  isDarkMode ? "border-zinc-800 text-zinc-500" : "border-zinc-200 text-zinc-400 bg-zinc-50/50"
                }`}>
                  <AlertTriangle className="w-12 h-12 mx-auto text-zinc-500 mb-3 animate-pulse" />
                  <p className="text-sm font-semibold">ไม่พบข้อมูลตามเงื่อนไขการค้นหา</p>
                  <p className="text-xs text-zinc-500 mt-1">ไม่มีข้อมูลประวัติในช่วงเวลาหรือคำค้นหาที่เลือกในฐานข้อมูล Firebase Firestore</p>
                </div>
              ) : (
                <>
                  <div className={`overflow-x-auto rounded-2xl border ${isDarkMode ? "border-zinc-800" : "border-zinc-200 shadow-sm"}`}>
                    <table className="w-full text-xs text-left font-mono">
                      <thead className={`font-bold uppercase text-[9px] tracking-wider border-b ${
                        isDarkMode ? "bg-black/40 text-zinc-550 border-zinc-800" : "bg-zinc-100 text-zinc-600 border-zinc-200"
                      }`}>
                        <tr>
                          <th className="px-4 py-3.5">TIMESTAMP</th>
                          <th className="px-4 py-3.5">DEVICE ID</th>
                          <th className="px-3 py-3.5 text-right">POWER (kW)</th>
                          <th className="px-3 py-3.5 text-right">VOLTAGE (V)</th>
                          <th className="px-3 py-3.5 text-right">CURRENT (A)</th>
                          <th className="px-3 py-3.5 text-right">ENERGY (KWH)</th>
                          <th className="px-3 py-3.5 text-right">FREQ (HZ)</th>
                          <th className="px-3 py-3.5 text-right">PF</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDarkMode ? "divide-zinc-800/60" : "divide-zinc-150"}`}>
                        {paginatedHistoryReadings.map((reading) => {
                          let timeStr = "-";
                          let dateStr = "-";
                          if (reading.timestamp) {
                            let dateObj: Date;
                            if (typeof reading.timestamp.toDate === "function") {
                              dateObj = reading.timestamp.toDate();
                            } else if (reading.timestamp instanceof Date) {
                              dateObj = reading.timestamp;
                            } else if (reading.timestamp.seconds) {
                              dateObj = new Date(reading.timestamp.seconds * 1000);
                            } else {
                              dateObj = new Date(reading.timestamp);
                            }
                            timeStr = dateObj.toLocaleTimeString("th-TH");
                            dateStr = dateObj.toLocaleDateString("th-TH");
                          }
                          
                          return (
                            <tr key={reading.id} className={`transition-colors ${
                              isDarkMode 
                                ? "hover:bg-zinc-800/30 text-zinc-400" 
                                : "hover:bg-zinc-50 text-zinc-700"
                            }`}>
                              <td className="px-4 py-3">
                                <div className={`font-semibold ${isDarkMode ? "text-zinc-300" : "text-zinc-800"}`}>{timeStr}</div>
                                <div className={`text-[10px] ${isDarkMode ? "text-zinc-600" : "text-zinc-400"}`}>{dateStr}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold bg-indigo-500/5 text-indigo-500 border-indigo-500/10`}>
                                  {reading.deviceId || "real_pzem"}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-right font-bold text-emerald-500">
                                {(reading.power / 1000).toFixed(4)}
                              </td>
                              <td className="px-3 py-3 text-right text-blue-500 font-semibold">{reading.voltage.toFixed(1)}</td>
                              <td className="px-3 py-3 text-right text-amber-500 font-semibold">{reading.current.toFixed(3)}</td>
                              <td className={`px-3 py-3 text-right font-medium ${isDarkMode ? "text-zinc-300" : "text-zinc-600"}`}>{reading.energy.toFixed(4)}</td>
                              <td className="px-3 py-3 text-right text-violet-500 font-semibold">{reading.frequency?.toFixed(1) || "50.0"}</td>
                              <td className="px-3 py-3 text-right text-rose-500 font-semibold">{reading.pf?.toFixed(2) || "0.95"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer Controls */}
                  <div className={`mt-5 pt-4 flex flex-col sm:flex-row justify-between items-center gap-4 border-t ${
                    isDarkMode ? "border-zinc-800/80 text-zinc-400" : "border-zinc-150 text-zinc-600"
                  }`}>
                    <span className="text-xs font-medium">
                      แสดงรายการที่ {(historyPage - 1) * historyItemsPerPage + 1} - {Math.min(searchedHistoryReadings.length, historyPage * historyItemsPerPage)} จากทั้งหมด {searchedHistoryReadings.length} รายการ
                    </span>
                    
                    <div className="flex items-center gap-2 select-none">
                      <button
                        onClick={() => setHistoryPage(prev => Math.max(1, prev - 1))}
                        disabled={historyPage === 1}
                        className={`p-1.5 rounded-xl border transition-colors flex items-center justify-center cursor-pointer ${
                          historyPage === 1
                            ? "opacity-40 cursor-not-allowed"
                            : isDarkMode
                              ? "bg-zinc-800/40 border-zinc-700/50 hover:bg-zinc-800 text-zinc-200"
                              : "bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-700 shadow-sm"
                        }`}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      
                      <span className="text-xs font-bold font-mono">
                        หน้า {historyPage} / {totalHistoryPages}
                      </span>
                      
                      <button
                        onClick={() => setHistoryPage(prev => Math.min(totalHistoryPages, prev + 1))}
                        disabled={historyPage === totalHistoryPages}
                        className={`p-1.5 rounded-xl border transition-colors flex items-center justify-center cursor-pointer ${
                          historyPage === totalHistoryPages
                            ? "opacity-40 cursor-not-allowed"
                            : isDarkMode
                              ? "bg-zinc-800/40 border-zinc-700/50 hover:bg-zinc-800 text-zinc-200"
                              : "bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-700 shadow-sm"
                        }`}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}

        {/* -------------------- TAB 3: SETTINGS & HARDWARE VIEW -------------------- */}
        {activeTab === "settings" && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
            id="tab-settings-content"
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Cost tariff */}
              <div className="lg:col-span-7 space-y-6">

                {/* Meter Calibration Card */}
                <div className={`p-6 rounded-3xl border transition-all duration-300 shadow-xl ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-200 shadow-sm"
                }`} id="meter-calibration-card">
                  <div className="space-y-4">
                    <h4 className={`font-semibold text-base flex items-center gap-1.5 ${
                      isDarkMode ? "text-white" : "text-zinc-800"
                    }`}>
                      <Cpu className="w-5 h-5 text-emerald-500 fill-emerald-500/20 drop-shadow-[0_0_4px_rgba(16,185,129,0.25)]" />
                      ตั้งค่าตัวเลขหน้าปัดมิเตอร์ไฟฟ้า (Meter Calibration)
                    </h4>
                    <p className={`text-xs leading-relaxed ${
                      isDarkMode ? "text-zinc-400" : "text-zinc-600"
                    }`}>
                      ปรับค่าพลังงานสะสม (kWh) ให้ตรงกับตัวเลขหน้าปัดมิเตอร์จริงที่ติดตั้งอยู่ในบ้านของคุณ ระบบจะคำนวณส่วนต่างเพื่อปรับตัวเลขบนหน้าจอให้ตรงกันโดยอัตโนมัติ
                    </p>
                    
                    <div className="space-y-2 max-w-md">
                      <label className={`text-xs font-bold block font-mono ${
                        isDarkMode ? "text-zinc-300" : "text-zinc-700"
                      }`}>ตัวเลขมิเตอร์สะสมจริงในปัจจุบัน (kWh):</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            placeholder={latestReading ? (latestReading.energy + meterOffset).toFixed(4) : "0.0000"}
                            id="input-meter-val"
                            className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono transition-colors duration-300 ${
                              isDarkMode ? "bg-black/50 border-zinc-800 text-white" : "bg-zinc-50 border-zinc-200 text-zinc-800"
                            }`}
                          />
                          <span className={`absolute right-4 top-3 text-xs font-semibold font-mono ${
                            isDarkMode ? "text-zinc-500" : "text-zinc-400"
                          }`}>kWh</span>
                        </div>
                        <button
                          onClick={() => {
                            const valEl = document.getElementById("input-meter-val") as HTMLInputElement;
                            const val = parseFloat(valEl?.value || "");
                            if (!isNaN(val) && val >= 0) {
                              const rawEnergy = latestReading ? latestReading.energy : 0;
                              const offset = val - rawEnergy;
                              setMeterOffset(offset);
                              localStorage.setItem("pzem_meter_offset", offset.toString());
                              updateGlobalSetting("meterOffset", offset);
                              alert(`ตั้งค่าตัวเลขมิเตอร์สะสมสำเร็จ!\nค่าชดเชยที่ปรับแต่ง: ${offset >= 0 ? "+" : ""}${offset.toFixed(4)} kWh`);
                            } else {
                              alert("กรุณากรอกตัวเลขมิเตอร์ที่ถูกต้องเป็นตัวเลขบวกหรือศูนย์");
                            }
                          }}
                          className="px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-black text-xs font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                        >
                          บันทึกค่ามิเตอร์
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 text-[11px] font-mono">
                      <div className={`p-2.5 rounded-xl border transition-colors duration-300 ${
                        isDarkMode ? "bg-black/30 border-zinc-800/60" : "bg-zinc-50 border-zinc-200"
                      }`}>
                        <div className={isDarkMode ? "text-zinc-550" : "text-zinc-500"}>ค่าจริงจากเซนเซอร์:</div>
                        <div className={`font-bold mt-0.5 ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>{(latestReading ? latestReading.energy : 0).toFixed(4)} kWh</div>
                      </div>
                      <div className={`p-2.5 rounded-xl border transition-colors duration-300 ${
                        isDarkMode ? "bg-black/30 border-zinc-800/60" : "bg-zinc-50 border-zinc-200"
                      }`}>
                        <div className={isDarkMode ? "text-zinc-550" : "text-zinc-500"}>ค่าชดเชย (Offset):</div>
                        <div className={`font-bold mt-0.5 ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>{meterOffset >= 0 ? "+" : ""}{meterOffset.toFixed(4)} kWh</div>
                      </div>
                      <div className={`p-2.5 rounded-xl border transition-colors duration-300 ${
                        isDarkMode ? "bg-emerald-500/5 border-emerald-500/10" : "bg-emerald-500/5 border-emerald-500/20"
                      }`}>
                        <div className="text-emerald-500 font-bold">มิเตอร์ชดเชยแล้ว:</div>
                        <div className="text-emerald-400 font-bold mt-0.5">{((latestReading ? latestReading.energy : 0) + meterOffset).toFixed(4)} kWh</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Billing & Cost Settings Card */}
                <div className={`p-6 rounded-3xl border transition-all duration-300 shadow-xl ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-200 shadow-sm"
                }`} id="billing-settings-card">
                  <div className="space-y-5">
                    <h4 className={`font-semibold text-base flex items-center gap-1.5 ${
                      isDarkMode ? "text-white" : "text-zinc-800"
                    }`}>
                      <Coins className="w-5 h-5 text-emerald-500 fill-emerald-500/20 drop-shadow-[0_0_4px_rgba(16,185,129,0.25)]" />
                      ตั้งค่าพารามิเตอร์คิดค่าไฟ (Billing & Cost Settings)
                    </h4>
                    <p className={`text-xs leading-relaxed ${
                      isDarkMode ? "text-zinc-400" : "text-zinc-600"
                    }`}>
                      ปรับแต่งอัตราค่า Ft, ค่าบริการรายเดือน, อัตราภาษีมูลค่าเพิ่ม และตั้งค่าตัวเลขมิเตอร์เริ่มต้นแต่ละรอบบิลได้ตามจริงตามบิลหรือตามผู้ให้บริการของคุณ
                    </p>

                    <div className={`space-y-4 pt-1 divide-y ${
                      isDarkMode ? "divide-zinc-800/60" : "divide-zinc-100"
                    }`}>
                      
                      {/* 1. Ft Rate Setup */}
                      <div className="space-y-2.5 pb-4">
                        <label className={`text-xs font-bold block font-mono ${
                          isDarkMode ? "text-zinc-300" : "text-zinc-700"
                        }`}>
                          1. อัตราค่า Ft ประจำงวด (บาท / หน่วย):
                        </label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type="number"
                              step="0.0001"
                              value={tempFtRate}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                const newVal = isNaN(val) ? 0 : val;
                                setTempFtRate(newVal);
                              }}
                              className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono transition-colors duration-300 ${
                                isDarkMode ? "bg-black/50 border-zinc-800 text-white" : "bg-zinc-50 border-zinc-200 text-zinc-800"
                              }`}
                            />
                            <span className={`absolute right-4 top-3 text-xs font-semibold font-mono ${
                              isDarkMode ? "text-zinc-500" : "text-zinc-400"
                            }`}>บาท/หน่วย</span>
                          </div>
                          <button
                            onClick={() => {
                              setTempFtRate(0.3972);
                            }}
                            className={`px-4 py-3 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                              isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700/50" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200"
                            }`}
                          >
                            ค่าเริ่มต้น (฿0.3972)
                          </button>
                        </div>
                      </div>

                      {/* 2. Monthly Service Fee */}
                      <div className="space-y-3 pt-4 pb-4">
                        <label className={`text-xs font-bold block font-mono ${
                          isDarkMode ? "text-zinc-300" : "text-zinc-700"
                        }`}>
                          2. ค่าบริการรายเดือน (บาท):
                        </label>
                        <div className={`flex p-1 rounded-xl border w-fit ${
                          isDarkMode ? "bg-black/50 border-zinc-800" : "bg-zinc-100 border-zinc-200"
                        }`}>
                          <button
                            onClick={() => {
                              setTempServiceFeeMode("auto");
                            }}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                              tempServiceFeeMode === "auto"
                                ? (isDarkMode ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm" : "bg-white text-zinc-800 border border-zinc-200 shadow-sm")
                                : "text-zinc-500 hover:text-zinc-400"
                            }`}
                          >
                            คำนวณอัตโนมัติ (8.19 หรือ 38.22 บ.)
                          </button>
                          <button
                            onClick={() => {
                              setTempServiceFeeMode("custom");
                            }}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                              tempServiceFeeMode === "custom"
                                ? (isDarkMode ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm" : "bg-white text-zinc-800 border border-zinc-200 shadow-sm")
                                : "text-zinc-500 hover:text-zinc-400"
                            }`}
                          >
                            กำหนดค่าคงที่เอง
                          </button>
                        </div>

                        {tempServiceFeeMode === "custom" && (
                          <div className="relative max-w-xs animate-in fade-in duration-200">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={tempCustomServiceFee}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                const newVal = isNaN(val) ? 0 : val;
                                setTempCustomServiceFee(newVal);
                              }}
                              className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono transition-colors duration-300 ${
                                isDarkMode ? "bg-black/50 border-zinc-800 text-white" : "bg-zinc-50 border-zinc-200 text-zinc-800"
                              }`}
                            />
                            <span className={`absolute right-4 top-3 text-xs font-semibold font-mono ${
                              isDarkMode ? "text-zinc-500" : "text-zinc-400"
                            }`}>บาท</span>
                          </div>
                        )}
                      </div>

                      {/* 3. VAT Percentage */}
                      <div className="space-y-2.5 pt-4 pb-4">
                        <label className={`text-xs font-bold block font-mono ${
                          isDarkMode ? "text-zinc-300" : "text-zinc-700"
                        }`}>
                          3. อัตราภาษีมูลค่าเพิ่ม (VAT %):
                        </label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              value={tempVatPercent}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                const newVal = isNaN(val) ? 0 : val;
                                setTempVatPercent(newVal);
                              }}
                              className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono transition-colors duration-300 ${
                                isDarkMode ? "bg-black/50 border-zinc-800 text-white" : "bg-zinc-50 border-zinc-200 text-zinc-800"
                              }`}
                            />
                            <span className={`absolute right-4 top-3 text-xs font-semibold font-mono ${
                              isDarkMode ? "text-zinc-500" : "text-zinc-400"
                            }`}>%</span>
                          </div>
                          <button
                            onClick={() => {
                              setTempVatPercent(7);
                            }}
                            className={`px-3.5 py-3 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                              isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700/50" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200"
                            }`}
                          >
                            7%
                          </button>
                          <button
                            onClick={() => {
                              setTempVatPercent(0);
                            }}
                            className={`px-3.5 py-3 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                              isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700/50" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200"
                            }`}
                          >
                            ไม่มี VAT (0%)
                          </button>
                        </div>
                      </div>

                      {/* 4. Billing Cycle Starting Meter Value */}
                      <div className="space-y-3 pt-4">
                        <label className={`text-xs font-bold block font-mono ${
                          isDarkMode ? "text-zinc-300" : "text-zinc-700"
                        }`}>
                          4. ตัวเลขมิเตอร์ตั้งต้นของรอบบิลนี้ (kWh):
                        </label>
                        <div className={`flex p-1 rounded-xl border w-fit ${
                          isDarkMode ? "bg-black/50 border-zinc-800" : "bg-zinc-100 border-zinc-200"
                        }`}>
                          <button
                            onClick={() => {
                              setTempBillingStartMeterMode("auto");
                            }}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                              tempBillingStartMeterMode === "auto"
                                ? (isDarkMode ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm" : "bg-white text-zinc-800 border border-zinc-200 shadow-sm")
                                : "text-zinc-500 hover:text-zinc-400"
                            }`}
                          >
                            คำนวณอัตโนมัติ (จากความต่างรอบบิลจริง)
                          </button>
                          <button
                            onClick={() => {
                              setTempBillingStartMeterMode("custom");
                            }}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                              tempBillingStartMeterMode === "custom"
                                ? (isDarkMode ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm" : "bg-white text-zinc-800 border border-zinc-200 shadow-sm")
                                : "text-zinc-500 hover:text-zinc-400"
                            }`}
                          >
                            ระบุค่าตั้งต้นเอง (Static)
                          </button>
                        </div>

                        {tempBillingStartMeterMode === "custom" && (
                          <div className="space-y-2 animate-in fade-in duration-200">
                            <div className="relative max-w-xs">
                              <input
                                type="number"
                                step="0.0001"
                                min="0"
                                value={tempBillingStartMeter}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  const newVal = isNaN(val) ? 0 : val;
                                  setTempBillingStartMeter(newVal);
                                }}
                                className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono transition-colors duration-300 ${
                                  isDarkMode ? "bg-black/50 border-zinc-800 text-white" : "bg-zinc-50 border-zinc-200 text-zinc-800"
                                }`}
                              />
                              <span className={`absolute right-4 top-3 text-xs font-semibold font-mono ${
                                isDarkMode ? "text-zinc-500" : "text-zinc-400"
                              }`}>kWh</span>
                            </div>
                            <div className={`text-[10px] font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-450"}`}>
                              * ตัวเลขมิเตอร์สะสมปัจจุบัน: <span className={`${isDarkMode ? "text-zinc-300" : "text-zinc-700"} font-bold`}>{currentMeterVal.toFixed(4)} kWh</span> (จำนวนหน่วยที่ใช้ในรอบบิลนี้: <span className="text-emerald-500 font-bold">{(Math.max(0, currentMeterVal - tempBillingStartMeter)).toFixed(4)} kWh</span>)
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Confirmation & Save Banner inside Card */}
                      {isSettingsChanged && (
                        <div className={`border p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 mt-2 animate-in fade-in duration-200 ${
                          isDarkMode ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50/50 border-amber-200"
                        }`}>
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className={`text-xs font-bold ${isDarkMode ? "text-amber-400" : "text-amber-700"}`}>ตรวจพบการเปลี่ยนแปลงพารามิเตอร์</p>
                              <p className={`text-[10px] mt-0.5 leading-relaxed font-sans ${isDarkMode ? "text-zinc-400" : "text-zinc-650"}`}>กรุณากดยืนยันเพื่อบันทึกค่าที่ได้มีการแก้ไข ไม่เช่นนั้นค่าจะไม่ถูกนำไปคำนวณจริง</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                            <button
                              onClick={() => {
                                setTempFtRate(ftRate);
                                setTempServiceFeeMode(serviceFeeMode);
                                setTempCustomServiceFee(customServiceFee);
                                setTempVatPercent(vatPercent);
                                setTempBillingStartMeterMode(billingStartMeterMode);
                                setTempBillingStartMeter(billingStartMeter);
                                setTempOverpowerThreshold(overpowerThreshold);
                                setTempIsSoundEnabled(isSoundEnabled);
                                setTempIsOverpowerAlertEnabled(isOverpowerAlertEnabled);
                                setTempIsOnlineOfflineAlertEnabled(isOnlineOfflineAlertEnabled);
                                setTempAutoPruneDays(autoPruneDays);
                              }}
                              className={`px-3 py-1.5 text-[11px] font-bold rounded-xl transition-all cursor-pointer ${
                                isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                              }`}
                            >
                              ยกเลิก
                            </button>
                            <button
                              onClick={() => {
                                setShowConfirmModal(true);
                              }}
                              className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-[11px] font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-amber-500/10"
                            >
                              ยืนยันการแก้ไข
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                </div>

                {/* Alarm & Safety Settings Card */}
                <div className={`p-6 rounded-3xl border transition-all duration-300 shadow-xl ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-200 shadow-sm"
                }`} id="safety-alarm-settings-card">
                  <div className="space-y-5">
                    <h4 className={`font-semibold text-base flex items-center gap-1.5 ${
                      isDarkMode ? "text-white" : "text-zinc-800"
                    }`}>
                      <BellRing className="w-5 h-5 text-rose-500 fill-rose-500/20 drop-shadow-[0_0_4px_rgba(239,68,68,0.25)] animate-pulse" />
                      ระบบควบคุมความปลอดภัยและการแจ้งเตือน (Safety & Alarm Settings)
                    </h4>
                    <p className={`text-xs leading-relaxed ${
                      isDarkMode ? "text-zinc-400" : "text-zinc-600"
                    }`}>
                      ตั้งค่าการแจ้งเตือนออนไลน์/ออฟไลน์ของเซนเซอร์ PZEM-004T ขีดจำกัดกำลังไฟเกินพิกัดสูงสุด (Over-power threshold) และควบคุมการทำงานของเสียงไซเรนเตือนภัยแบบเรียลไทม์
                    </p>

                    <div className="space-y-4 pt-1">
                      {/* 1. Overpower Limit Wattage */}
                      <div className="space-y-2">
                        <label className={`text-xs font-bold block font-mono ${
                          isDarkMode ? "text-zinc-300" : "text-zinc-700"
                        }`}>
                          เกณฑ์กำลังไฟฟ้าเกินจำกัดสูงสุด (Overpower Limit - Watts):
                        </label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type="number"
                              step="50"
                              min="100"
                              max="20000"
                              value={tempOverpowerThreshold}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setTempOverpowerThreshold(isNaN(val) ? 0 : val);
                              }}
                              className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent font-mono transition-colors duration-300 ${
                                isDarkMode ? "bg-black/50 border-zinc-800 text-white" : "bg-zinc-50 border-zinc-200 text-zinc-800"
                              }`}
                            />
                            <span className={`absolute right-4 top-3 text-xs font-semibold font-mono ${
                              isDarkMode ? "text-zinc-500" : "text-zinc-400"
                            }`}>W (วัตต์)</span>
                          </div>
                          <button
                            onClick={() => setTempOverpowerThreshold(2000)}
                            className={`px-3.5 py-3 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                              isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700/50" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200"
                            }`}
                          >
                            2000W
                          </button>
                          <button
                            onClick={() => setTempOverpowerThreshold(4500)}
                            className={`px-3.5 py-3 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                              isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700/50" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200"
                            }`}
                          >
                            4500W
                          </button>
                        </div>
                      </div>

                      {/* Toggles for safety */}
                      <div className={`p-4 rounded-2xl border space-y-4 ${
                        isDarkMode ? "bg-black/30 border-zinc-800" : "bg-zinc-50 border-zinc-200/80"
                      }`}>
                        {/* Audio Toggle */}
                        <div className="flex items-center justify-between">
                          <div className="flex gap-2.5 items-start">
                            {tempIsSoundEnabled ? (
                              <Volume2 className="w-4 h-4 text-rose-500 mt-0.5 animate-bounce" />
                            ) : (
                              <VolumeX className="w-4 h-4 text-zinc-500 mt-0.5" />
                            )}
                            <div className="text-left">
                              <p className="text-xs font-bold leading-none">เสียงสัญญาณเตือนภัย (Audio Alerts Chime)</p>
                              <p className={`text-[10px] mt-1 ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>เปิดเสียงไซเรนเตือนความถี่สูงเมื่อเกิดกำลังไฟเกินกำหนดในระบบ</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setTempIsSoundEnabled(!tempIsSoundEnabled)}
                            className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 shrink-0 ${
                              tempIsSoundEnabled ? "bg-rose-500 justify-end" : "bg-zinc-700 justify-start"
                            }`}
                          >
                            <motion.div layout className="bg-white w-4 h-4 rounded-full shadow-md" />
                          </button>
                        </div>

                        {/* Overpower Alerts Toggle */}
                        <div className={`flex items-center justify-between border-t pt-3 ${
                          isDarkMode ? "border-zinc-800/30" : "border-zinc-200/40"
                        }`}>
                          <div className="flex gap-2.5 items-start">
                            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
                            <div className="text-left">
                              <p className="text-xs font-bold leading-none">แจ้งเตือนกำลังไฟฟ้าเกินพิกัด (Over-power Notification)</p>
                              <p className={`text-[10px] mt-1 ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>ลงทะเบียนประวัติและแสดงแบนเนอร์แจ้งเตือนทันทีเมื่อใช้ไฟเกินค่าวัตต์ที่ตั้งไว้</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setTempIsOverpowerAlertEnabled(!tempIsOverpowerAlertEnabled)}
                            className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 shrink-0 ${
                              tempIsOverpowerAlertEnabled ? "bg-rose-500 justify-end" : "bg-zinc-700 justify-start"
                            }`}
                          >
                            <motion.div layout className="bg-white w-4 h-4 rounded-full shadow-md" />
                          </button>
                        </div>

                        {/* Connection Alerts Toggle */}
                        <div className={`flex items-center justify-between border-t pt-3 ${
                          isDarkMode ? "border-zinc-800/30" : "border-zinc-200/40"
                        }`}>
                          <div className="flex gap-2.5 items-start">
                            <ShieldAlert className="w-4 h-4 text-emerald-500 mt-0.5" />
                            <div className="text-left">
                              <p className="text-xs font-bold leading-none">แจ้งเตือนอุปกรณ์ ออนไลน์ / ออฟไลน์ (Online / Offline Alerts)</p>
                              <p className={`text-[10px] mt-1 ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>รับแจ้งเตือนเมื่อบอร์ด ESP32 ขาดการติดต่อจากเครือข่ายเกิน 60 วินาที</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setTempIsOnlineOfflineAlertEnabled(!tempIsOnlineOfflineAlertEnabled)}
                            className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 shrink-0 ${
                              tempIsOnlineOfflineAlertEnabled ? "bg-rose-500 justify-end" : "bg-zinc-700 justify-start"
                            }`}
                          >
                            <motion.div layout className="bg-white w-4 h-4 rounded-full shadow-md" />
                          </button>
                        </div>

                        {/* Native Browser Push Notification Permission Status */}
                        <div className={`flex flex-col gap-2.5 border-t pt-3 ${
                          isDarkMode ? "border-zinc-800/30" : "border-zinc-200/40"
                        }`}>
                          <div className="flex items-center justify-between">
                            <div className="flex gap-2.5 items-start">
                              <BellRing className={`w-4 h-4 mt-0.5 shrink-0 ${
                                browserNotificationPermission === "granted" ? "text-indigo-500 animate-pulse" : "text-zinc-500"
                              }`} />
                              <div className="text-left">
                                <p className="text-xs font-bold leading-none">แจ้งเตือนระบบภายนอกแอป (Background Push Notifications)</p>
                                <p className={`text-[10px] mt-1 leading-normal ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
                                  ส่งการแจ้งเตือนทันทีบนหน้าจอมือถือหรือคอมพิวเตอร์ของคุณ แม้จะย่อหน้าจอหรือไม่ได้เปิดแอปนี้ดูอยู่ก็ตาม
                                </p>
                              </div>
                            </div>

                            <div className="shrink-0 pl-2">
                              {browserNotificationPermission === "granted" ? (
                                <span className={`px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider block ${
                                  isDarkMode ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" : "bg-indigo-50 text-indigo-700 border border-indigo-200"
                                }`}>
                                  เปิดแล้ว
                                </span>
                              ) : browserNotificationPermission === "denied" ? (
                                <span className={`px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider block ${
                                  isDarkMode ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" : "bg-rose-50 text-rose-700 border border-rose-200"
                                }`}>
                                  ถูกปิดกั้น
                                </span>
                              ) : (
                                <button
                                  onClick={requestNotificationPermission}
                                  className="px-2.5 py-1 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all duration-300 shadow-md shadow-indigo-500/10 cursor-pointer shrink-0"
                                >
                                  เปิดใช้งาน
                                </button>
                              )}
                            </div>
                          </div>

                          {browserNotificationPermission === "denied" && (
                            <div className={`p-2.5 rounded-xl text-[10px] leading-relaxed text-left border ${
                              isDarkMode ? "bg-rose-950/20 border-rose-900/30 text-rose-400" : "bg-rose-550/10 border-rose-100 text-rose-700"
                            }`}>
                              ⚠️ <strong>สิทธิ์การแจ้งเตือนถูกบล็อก:</strong> กรุณาคลิกสัญลักษณ์รูปกุญแจในแถบ URL แล้วตั้งค่า "การแจ้งเตือน" ให้เป็น "อนุญาต" เพื่อเปิดรับแจ้งเตือนเมื่ออยู่ในหน้าจอหลักหรือใช้งานแอปอื่นอยู่
                            </div>
                          )}

                          {browserNotificationPermission === "granted" && (
                            <div className={`p-2.5 rounded-xl text-[10px] leading-relaxed text-left border ${
                              isDarkMode ? "bg-emerald-950/20 border-emerald-900/30 text-emerald-400" : "bg-emerald-550/10 border-emerald-100 text-emerald-750"
                            }`}>
                              💡 <strong>คำแนะนำ:</strong> เพื่อให้การเตือนไฟเกินพิกัดและสถานะออฟไลน์ส่งเสียงและแจ้งเตือนคุณแบบเรียลไทม์ได้ตลอดเวลา โปรดเปิดแท็บแอปนี้ทิ้งไว้ในเบื้องหลัง
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Confirmation & Save Banner inside Card */}
                      {isSettingsChanged && (
                        <div className={`border p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 mt-2 animate-in fade-in duration-200 ${
                          isDarkMode ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50/50 border-amber-200"
                        }`}>
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className={`text-xs font-bold ${isDarkMode ? "text-amber-400" : "text-amber-700"}`}>ตรวจพบการเปลี่ยนแปลงพารามิเตอร์</p>
                              <p className={`text-[10px] mt-0.5 leading-relaxed font-sans ${isDarkMode ? "text-zinc-400" : "text-zinc-650"}`}>กรุณากดยืนยันเพื่อบันทึกค่าที่ได้มีการแก้ไข ไม่เช่นนั้นค่าจะไม่ถูกนำไปคำนวณจริง</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                            <button
                              onClick={() => {
                                setTempFtRate(ftRate);
                                setTempServiceFeeMode(serviceFeeMode);
                                setTempCustomServiceFee(customServiceFee);
                                setTempVatPercent(vatPercent);
                                setTempBillingStartMeterMode(billingStartMeterMode);
                                setTempBillingStartMeter(billingStartMeter);
                                setTempOverpowerThreshold(overpowerThreshold);
                                setTempIsSoundEnabled(isSoundEnabled);
                                setTempIsOverpowerAlertEnabled(isOverpowerAlertEnabled);
                                setTempIsOnlineOfflineAlertEnabled(isOnlineOfflineAlertEnabled);
                                setTempAutoPruneDays(autoPruneDays);
                              }}
                              className={`px-3 py-1.5 text-[11px] font-bold rounded-xl transition-all cursor-pointer ${
                                isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                              }`}
                            >
                              ยกเลิก
                            </button>
                            <button
                              onClick={() => {
                                setShowConfirmModal(true);
                              }}
                              className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-[11px] font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-amber-500/10"
                            >
                              ยืนยันการแก้ไข
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                </div>

              </div>

              {/* Right Column: Database Storage */}
              <div className="lg:col-span-5 space-y-6">

                {/* Database & Storage Management Card */}
                <div className={`p-6 rounded-3xl border transition-all duration-300 shadow-xl ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-200 shadow-sm"
                }`}>
                  <div className="space-y-4">
                    <h4 className={`font-semibold text-base flex items-center gap-1.5 ${
                      isDarkMode ? "text-white" : "text-zinc-800"
                    }`}>
                      <Database className="w-5 h-5 text-indigo-500 fill-indigo-500/20 drop-shadow-[0_0_4px_rgba(99,102,241,0.25)]" />
                      จัดการข้อมูลและพื้นที่จัดเก็บ (Database Storage)
                    </h4>
                    <p className={`text-xs leading-relaxed ${
                      isDarkMode ? "text-zinc-400" : "text-zinc-600"
                    }`}>
                      ข้อมูลปริมาณมากจาก PZEM-004T และ ESP32 อาจส่งผลต่อการใช้โควต้าในระบบคลาวด์ Firestore คุณสามารถเปิดใช้ระบบแยกและลบข้อมูลเก่าออกอัตโนมัติ หรือทำการล้างประวัติด้วยตนเองได้ที่นี่
                    </p>

                    <div className="space-y-3 pt-2">
                      <label className={`text-xs font-bold block font-mono ${
                        isDarkMode ? "text-zinc-300" : "text-zinc-700"
                      }`}>
                        ระบบลบประวัติเก่าอัตโนมัติ (Auto-Prune Old Data):
                      </label>
                      <select
                        value={tempAutoPruneDays}
                        onChange={(e) => {
                          setTempAutoPruneDays(parseInt(e.target.value));
                        }}
                        className={`w-full px-3 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors duration-300 ${
                          isDarkMode ? "bg-black/50 border-zinc-800 text-white" : "bg-zinc-50 border-zinc-200 text-zinc-800"
                        }`}
                      >
                        <option value="0">ปิดการทำงาน (เก็บข้อมูลไว้ทั้งหมด)</option>
                        <option value="3">เก็บเฉพาะข้อมูล 3 วันล่าสุด (แนะนำเพื่อความเร็วสูงสุด)</option>
                        <option value="7">เก็บเฉพาะข้อมูล 7 วันล่าสุด</option>
                        <option value="15">เก็บเฉพาะข้อมูล 15 วันล่าสุด</option>
                        <option value="30">เก็บเฉพาะข้อมูล 30 วันล่าสุด</option>
                        <option value="90">เก็บเฉพาะข้อมูล 90 วันล่าสุด</option>
                      </select>
                      <p className={`text-[10px] leading-normal ${
                        isDarkMode ? "text-zinc-500" : "text-zinc-400"
                      }`}>
                        * เมื่อเปิดใช้ ระบบจะตรวจเช็กและทำการลบข้อมูลที่เก่ากว่ากำหนดโดยอัตโนมัติในเบื้องหลังเมื่อเปิดแอปพลิเคชัน
                      </p>

                      {/* Database Settings Save Banner */}
                      {isSettingsChanged && (
                        <div className={`border p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-3 animate-in fade-in duration-200 ${
                          isDarkMode ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50/50 border-amber-200"
                        }`}>
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className={`text-xs font-bold text-left ${isDarkMode ? "text-amber-400" : "text-amber-700"}`}>ตรวจพบการเปลี่ยนแปลงค่าระบบ</p>
                              <p className={`text-[10px] mt-0.5 leading-relaxed text-left font-sans ${isDarkMode ? "text-zinc-400" : "text-zinc-650"}`}>กรุณากดยืนยันเพื่อบันทึกและซิงค์การตั้งค่านี้ให้ตรงกันทุกอุปกรณ์</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                            <button
                              onClick={() => {
                                setTempFtRate(ftRate);
                                setTempServiceFeeMode(serviceFeeMode);
                                setTempCustomServiceFee(customServiceFee);
                                setTempVatPercent(vatPercent);
                                setTempBillingStartMeterMode(billingStartMeterMode);
                                setTempBillingStartMeter(billingStartMeter);
                                setTempOverpowerThreshold(overpowerThreshold);
                                setTempIsSoundEnabled(isSoundEnabled);
                                setTempIsOverpowerAlertEnabled(isOverpowerAlertEnabled);
                                setTempIsOnlineOfflineAlertEnabled(isOnlineOfflineAlertEnabled);
                                setTempAutoPruneDays(autoPruneDays);
                              }}
                              className={`px-3 py-1.5 text-[11px] font-bold rounded-xl transition-all cursor-pointer ${
                                isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                              }`}
                            >
                              ยกเลิก
                            </button>
                            <button
                              onClick={() => {
                                setShowConfirmModal(true);
                              }}
                              className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-[11px] font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-amber-500/10"
                            >
                              ยืนยันการแก้ไข
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className={`border-t pt-4 mt-2 space-y-3 ${
                      isDarkMode ? "border-zinc-800/60" : "border-zinc-150"
                    }`}>
                      <div className="text-left">
                        <span className={`text-xs font-bold block ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>ล้างข้อมูลทั้งหมดด้วยตนเอง (Manual Purge):</span>
                        <span className={`text-[10px] leading-relaxed mt-1 block ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
                          ลบข้อมูลบันทึกทั้งหมดของมิเตอร์นี้ออกจาก Firestore ในรอบบิลปัจจุบันทันที (ไม่มีผลต่อการตั้งค่าระบบ)
                        </span>
                      </div>
                      <button
                        onClick={clearHistory}
                        disabled={isClearing}
                        className="w-full py-2.5 px-4 bg-rose-600/10 hover:bg-rose-600/25 text-rose-500 hover:text-rose-400 border border-rose-500/20 hover:border-rose-500/30 text-xs font-bold rounded-xl transition-all duration-300 cursor-pointer flex items-center justify-center gap-2"
                      >
                        {isClearing ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        ล้างข้อมูลประวัติและค่าทั้งหมด
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* -------------------- TAB 4: ABOUT & HARDWARE VIEW -------------------- */}
        {activeTab === "about" && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
            id="tab-about-content"
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: ESP32 Wiring & Code */}
              <div className="lg:col-span-7 space-y-6">
                <HardwareGuide />
              </div>

              {/* Right Column: Tariff & PWA Installation */}
              <div className="lg:col-span-5 space-y-6">
                {/* Tariff Step Info Card */}
                <div className={`p-6 rounded-3xl border transition-all duration-300 shadow-xl ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-200 shadow-sm"
                }`} id="tariff-info-card">
                  <div className="space-y-4">
                    <h4 className={`font-semibold text-base flex items-center gap-1.5 ${
                      isDarkMode ? "text-white" : "text-zinc-800"
                    }`}>
                      <Coins className="w-5 h-5 text-emerald-500 fill-emerald-500/20 drop-shadow-[0_0_4px_rgba(16,185,129,0.25)]" />
                      โครงสร้างอัตราค่าไฟฟ้าขั้นบันได (Residential Tariff Type 1.1)
                    </h4>
                    <p className={`text-xs leading-relaxed ${
                      isDarkMode ? "text-zinc-400" : "text-zinc-600"
                    }`}>
                      ระบบคำนวณค่าไฟฟ้าแบบขั้นบันไดจริงตามมาตรฐานการไฟฟ้านครหลวงและการไฟฟ้าส่วนภูมิภาคสำหรับบ้านพักอาศัย โดยจะคำนวณตัดรอบบิลโดยอัตโนมัติในทุกวันที่ 25 ของแต่ละเดือน (นับจากวันที่ 26 ของเดือนก่อนหน้า ถึงวันที่ 25 ของเดือนปัจจุบัน)
                    </p>
                    
                    <div className={`overflow-x-auto rounded-xl border ${
                      isDarkMode ? "border-zinc-800" : "border-zinc-200"
                    }`}>
                      <table className={`w-full text-[11px] font-mono text-left ${
                        isDarkMode ? "text-zinc-400" : "text-zinc-650"
                      }`}>
                        <thead className={`text-[10px] font-bold ${
                          isDarkMode ? "bg-black/40 text-zinc-500" : "bg-zinc-50 text-zinc-500"
                        }`}>
                          <tr>
                            <th className="px-3 py-2.5">ช่วงปริมาณการใช้พลังงานไฟฟ้า</th>
                            <th className="px-3 py-2.5 text-right">อัตรา (บาท / หน่วย)</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${
                          isDarkMode ? "divide-zinc-800" : "divide-zinc-100"
                        }`}>
                          <tr>
                            <td className="px-3 py-2">15 หน่วยแรก (หน่วยที่ 0 - 15)</td>
                            <td className={`px-3 py-2 text-right font-bold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>2.3488</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2">10 หน่วยถัดไป (หน่วยที่ 16 - 25)</td>
                            <td className={`px-3 py-2 text-right font-bold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>2.9882</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2">10 หน่วยถัดไป (หน่วยที่ 26 - 35)</td>
                            <td className={`px-3 py-2 text-right font-bold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>3.2405</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2">65 หน่วยถัดไป (หน่วยที่ 36 - 100)</td>
                            <td className={`px-3 py-2 text-right font-bold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>3.6237</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2">50 หน่วยถัดไป (หน่วยที่ 101 - 150)</td>
                            <td className={`px-3 py-2 text-right font-bold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>3.7171</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2">250 หน่วยถัดไป (หน่วยที่ 151 - 400)</td>
                            <td className={`px-3 py-2 text-right font-bold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>4.2218</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2">ส่วนที่เกิน 400 หน่วยขึ้นไป</td>
                            <td className={`px-3 py-2 text-right font-bold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>4.4217</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    
                    <div className={`p-3 rounded-xl border text-[11px] font-mono space-y-1 transition-colors duration-300 ${
                      isDarkMode ? "bg-black/20 border-zinc-800/40 text-zinc-500" : "bg-zinc-50 border-zinc-200 text-zinc-500"
                    }`}>
                      <div>{"• มีค่าบริการรายเดือนเพิ่มเติม: ฿8.19 (หากใช้ <= 150 หน่วย) หรือ ฿38.22 (หากใช้ > 150 หน่วย)"}</div>
                      <div>• อัตราค่า Ft เฉลี่ยชดเชยคงที่: ฿0.3972 ต่อหน่วย</div>
                      <div>• รวมภาษีมูลค่าเพิ่ม (VAT): 7% สำหรับสุทธิของบิลค่าไฟทั้งหมด</div>
                    </div>
                  </div>
                </div>

                {/* PWA Installation Assistant Card */}
                <div className={`p-6 rounded-3xl border transition-all duration-300 shadow-xl ${
                  isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-200 shadow-sm"
                }`}>
                  <div className="space-y-4">
                    <h4 className={`font-semibold text-base flex items-center gap-1.5 ${
                      isDarkMode ? "text-white" : "text-zinc-800"
                    }`}>
                      <Download className="w-5 h-5 text-emerald-500 fill-emerald-500/20 drop-shadow-[0_0_4px_rgba(16,185,129,0.25)]" />
                      ติดตั้งแอปพลิเคชัน (PWA Installation)
                    </h4>
                    <p className={`text-xs leading-relaxed ${
                      isDarkMode ? "text-zinc-400" : "text-zinc-600"
                    }`}>
                      คุณสามารถติดตั้งแอป ENERGY SMALI Monitor ลงบนหน้าจอหลักของโทรศัพท์มือถือ แท็บเล็ต หรือคอมพิวเตอร์ เพื่อให้การทำงานลื่นไหลเสมือนเป็นแอปตัวเครื่องโดยตรง และสามารถเรียกใช้งานได้แม้ออฟไลน์
                    </p>
                    
                    {deferredPrompt ? (
                      <div className="space-y-3">
                        <div className={`p-3 rounded-2xl border text-xs flex items-center gap-2 font-mono ${
                          isDarkMode ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-emerald-50 border-emerald-200 text-emerald-700"
                        }`}>
                          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                          พร้อมสำหรับการติดตั้งบนอุปกรณ์นี้แล้ว!
                        </div>
                        <button
                          onClick={handleInstallClick}
                          className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-black text-xs font-bold rounded-xl transition-all duration-300 cursor-pointer flex items-center justify-center gap-2 shadow-md active:scale-[0.98]"
                        >
                          <Download className="w-4 h-4" />
                          ติดตั้งแอปพลิเคชันลงบนเครื่องนี้
                        </button>
                      </div>
                    ) : isPWAInstalled ? (
                      <div className={`p-4 rounded-2xl border text-xs flex items-center gap-3 font-mono ${
                        isDarkMode ? "bg-zinc-800/40 border-zinc-800 text-zinc-400" : "bg-zinc-50 border-zinc-200 text-zinc-600"
                      }`}>
                        <div className="p-2 bg-emerald-500/15 text-emerald-500 rounded-xl">
                          <CheckCircle className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-bold text-emerald-500">ติดตั้งสำเร็จแล้ว!</div>
                          <div className="text-[10px] mt-0.5">ระบบพร้อมทำงานในโหมดแอปพลิเคชันเดี่ยว (Standalone) แล้ว</div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className={`p-4 rounded-2xl border text-xs space-y-2 font-mono ${
                          isDarkMode ? "bg-zinc-800/20 border-zinc-800/60 text-zinc-400" : "bg-zinc-50 border-zinc-200 text-zinc-600"
                        }`}>
                          <div className="font-bold flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-blue-400" />
                            วิธีการติดตั้งด้วยตนเอง:
                          </div>
                          <ul className="list-disc list-inside space-y-1 text-[10px] pl-1 leading-relaxed">
                            <li><strong>บน iOS (Safari):</strong> แแตะที่ปุ่ม <span className="underline">แชร์ (Share)</span> แล้วเลือก <strong>"เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)"</strong></li>
                            <li><strong>บน Android / PC (Chrome):</strong> กดเครื่องหมายจุดสามจุดบริเวณมุมขวา แล้วเลือก <strong>"ติดตั้งแอป (Install App)"</strong></li>
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

      </main>

      {/* Footer information bar matching the mockup */}
      <footer className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-6 border-t flex flex-col md:flex-row justify-between items-center text-[10px] font-mono gap-4 ${
        isDarkMode ? "border-zinc-900 text-zinc-600" : "border-zinc-200 text-zinc-500"
      }`}>
        <div className="flex flex-wrap gap-4">
          <span>ESP32 FIRMWARE: v1.0.8-STABLE</span>
          <span>BAUD_RATE: 115200 bps</span>
          <span>PZEM PROTOCOL: MODBUS-RTU</span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            UART SERIAL COMM2
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
            FIRESTORE REST STREAM
          </span>
        </div>
      </footer>

      </div>

      {/* Confirmation Modal for Billing settings updates */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 ${
            isDarkMode ? "bg-zinc-950 border-zinc-800" : "bg-white border-zinc-200"
          }`}>
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-2xl border ${
                isDarkMode ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-amber-50 text-amber-600 border-amber-200"
              }`}>
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className={`font-bold text-base ${isDarkMode ? "text-white" : "text-zinc-800"}`}>ยืนยันการบันทึกค่าพารามิเตอร์?</h3>
                <p className={`text-xs mt-0.5 ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>กรุณาตรวจสอบการเปลี่ยนแปลงด้านล่างนี้ก่อนกดยืนยัน</p>
              </div>
            </div>

            <div className={`p-4 rounded-2xl border text-[11px] font-mono space-y-2.5 ${
              isDarkMode ? "bg-zinc-900/60 border-zinc-800/80 text-zinc-300" : "bg-zinc-50 border-zinc-200 text-zinc-700"
            }`}>
              <div className={`flex justify-between border-b pb-2 ${isDarkMode ? "border-zinc-800/40" : "border-zinc-200/60"}`}>
                <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>1. อัตรา Ft:</span>
                <span>{ftRate.toFixed(4)} ➜ <span className="text-emerald-500 font-bold">{tempFtRate.toFixed(4)} บ./หน่วย</span></span>
              </div>
              <div className={`flex justify-between border-b pb-2 ${isDarkMode ? "border-zinc-800/40" : "border-zinc-200/60"}`}>
                <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>2. รูปแบบค่าบริการ:</span>
                <span>{serviceFeeMode === "auto" ? "อัตโนมัติ" : "กำหนดเอง"} ➜ <span className="text-emerald-500 font-bold">{tempServiceFeeMode === "auto" ? "อัตโนมัติ" : "กำหนดเอง"}</span></span>
              </div>
              {tempServiceFeeMode === "custom" && (
                <div className={`flex justify-between border-b pb-2 pl-3 ${isDarkMode ? "border-zinc-800/40" : "border-zinc-200/60"}`}>
                  <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>ค่าบริการคงที่:</span>
                  <span>{customServiceFee.toFixed(2)} ➜ <span className="text-emerald-500 font-bold">{tempCustomServiceFee.toFixed(2)} บาท</span></span>
                </div>
              )}
              <div className={`flex justify-between border-b pb-2 ${isDarkMode ? "border-zinc-800/40" : "border-zinc-200/60"}`}>
                <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>3. อัตรา VAT:</span>
                <span>{vatPercent}% ➜ <span className="text-emerald-500 font-bold">{tempVatPercent}%</span></span>
              </div>
              <div className={`flex justify-between border-b pb-2 ${isDarkMode ? "border-zinc-800/40" : "border-zinc-200/60"}`}>
                <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>4. มิเตอร์ตั้งต้น:</span>
                <span>{billingStartMeterMode === "auto" ? "อัตโนมัติ" : "กำหนดเอง"} ➜ <span className="text-emerald-500 font-bold">{tempBillingStartMeterMode === "auto" ? "อัตโนมัติ" : "กำหนดเอง"}</span></span>
              </div>
              {tempBillingStartMeterMode === "custom" && (
                <div className={`flex justify-between border-b pb-2 pl-3 ${isDarkMode ? "border-zinc-800/40" : "border-zinc-200/60"}`}>
                  <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>มิเตอร์ตั้งต้นคงที่:</span>
                  <span>{billingStartMeter.toFixed(4)} ➜ <span className="text-emerald-500 font-bold">{tempBillingStartMeter.toFixed(4)} kWh</span></span>
                </div>
              )}
              <div className={`flex justify-between border-b pb-2 ${isDarkMode ? "border-zinc-800/40" : "border-zinc-200/60"}`}>
                <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>5. เกณฑ์กำลังไฟเกิน:</span>
                <span>{overpowerThreshold}W ➜ <span className="text-rose-500 font-bold">{tempOverpowerThreshold}W</span></span>
              </div>
              <div className={`flex justify-between border-b pb-2 ${isDarkMode ? "border-zinc-800/40" : "border-zinc-200/60"}`}>
                <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>6. แจ้งเตือนความปลอดภัย:</span>
                <span className="text-emerald-500 font-bold">
                  {tempIsSoundEnabled ? "เปิดเสียง" : "ปิดเสียง"} / {tempIsOverpowerAlertEnabled ? "แจ้งเตือนเกินพิกัด" : "ปิดแจ้งเตือน"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>7. ลบประวัติเก่าอัตโนมัติ:</span>
                <span>{autoPruneDays === 0 ? "ปิด" : `${autoPruneDays} วัน`} ➜ <span className="text-emerald-500 font-bold">{tempAutoPruneDays === 0 ? "ปิด" : `${tempAutoPruneDays} วัน`}</span></span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className={`flex-1 px-4 py-3 text-xs font-bold rounded-xl transition-colors cursor-pointer ${
                  isDarkMode ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                }`}
              >
                ย้อนกลับ
              </button>
              <button
                onClick={async () => {
                  try {
                    // Update main states
                    setFtRate(tempFtRate);
                    setServiceFeeMode(tempServiceFeeMode);
                    setCustomServiceFee(tempCustomServiceFee);
                    setVatPercent(tempVatPercent);
                    setBillingStartMeterMode(tempBillingStartMeterMode);
                    setBillingStartMeter(tempBillingStartMeter);
                    setOverpowerThreshold(tempOverpowerThreshold);
                    setIsSoundEnabled(tempIsSoundEnabled);
                    setIsOverpowerAlertEnabled(tempIsOverpowerAlertEnabled);
                    setIsOnlineOfflineAlertEnabled(tempIsOnlineOfflineAlertEnabled);
                    setAutoPruneDays(tempAutoPruneDays);

                    // Update localStorage
                    localStorage.setItem("pzem_ft_rate", tempFtRate.toString());
                    localStorage.setItem("pzem_service_fee_mode", tempServiceFeeMode);
                    localStorage.setItem("pzem_custom_service_fee", tempCustomServiceFee.toString());
                    localStorage.setItem("pzem_vat_percent", tempVatPercent.toString());
                    localStorage.setItem("pzem_billing_start_meter_mode", tempBillingStartMeterMode);
                    localStorage.setItem("pzem_billing_start_meter", tempBillingStartMeter.toString());
                    localStorage.setItem("pzem_overpower_threshold", tempOverpowerThreshold.toString());
                    localStorage.setItem("pzem_sound_enabled", tempIsSoundEnabled ? "true" : "false");
                    localStorage.setItem("pzem_overpower_enabled", tempIsOverpowerAlertEnabled ? "true" : "false");
                    localStorage.setItem("pzem_online_offline_enabled", tempIsOnlineOfflineAlertEnabled ? "true" : "false");
                    localStorage.setItem("pzem_auto_prune_days", tempAutoPruneDays.toString());

                    // Save to Firestore at once
                    await updateGlobalSettings({
                      ftRate: tempFtRate,
                      serviceFeeMode: tempServiceFeeMode,
                      customServiceFee: tempCustomServiceFee,
                      vatPercent: tempVatPercent,
                      billingStartMeterMode: tempBillingStartMeterMode,
                      billingStartMeter: tempBillingStartMeter,
                      overpowerThreshold: tempOverpowerThreshold,
                      isSoundEnabled: tempIsSoundEnabled,
                      isOverpowerAlertEnabled: tempIsOverpowerAlertEnabled,
                      isOnlineOfflineAlertEnabled: tempIsOnlineOfflineAlertEnabled,
                      autoPruneDays: tempAutoPruneDays,
                    });

                    // If auto-prune was just enabled/changed, let's trigger it immediately
                    if (tempAutoPruneDays > 0) {
                      runAutoPruning(tempAutoPruneDays);
                    }

                    setShowConfirmModal(false);
                  } catch (err) {
                    console.error("Error saving settings:", err);
                    alert("เกิดข้อผิดพลาดในการบันทึกค่า");
                  }
                }}
                className="flex-1 px-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-black text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-lg shadow-emerald-500/10"
              >
                ยืนยันการบันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
