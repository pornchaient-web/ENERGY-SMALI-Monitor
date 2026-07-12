import React, { useState, useMemo } from "react";
import { PowerReading } from "../types";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp, Activity, Zap, Layers, Calendar, Info } from "lucide-react";

interface ChartSectionProps {
  data: PowerReading[];
  isDarkMode?: boolean;
  historyFilter: "all" | "today" | "yesterday" | "7days" | "1month" | "billing";
  setHistoryFilter: (filter: "all" | "today" | "yesterday" | "7days" | "1month" | "billing") => void;
  selectedBillingPeriodIndex: number;
  setSelectedBillingPeriodIndex: (idx: number) => void;
  getBillingPeriodsList: () => Array<{ label: string; start: Date; end: Date }>;
}

// Thai month names short
const getThaiMonthShort = (monthIdx: number) => {
  const months = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
  ];
  return months[monthIdx] || "";
};

// Helper to safely parse any Firestore / JS Date / ISO timestamp
const getReadingDate = (r: PowerReading): Date => {
  if (!r.timestamp) return new Date();
  if (typeof r.timestamp.toDate === "function") {
    return r.timestamp.toDate();
  } else if (r.timestamp instanceof Date) {
    return r.timestamp;
  } else if (r.timestamp.seconds) {
    return new Date(r.timestamp.seconds * 1000);
  } else {
    return new Date(r.timestamp);
  }
};

// Aggregation function for downsampling data
const aggregateData = (readingsList: PowerReading[], groupBy: "none" | "hour" | "day") => {
  if (groupBy === "none") {
    return readingsList
      .map(r => {
        const date = getReadingDate(r);
        const timeStr = date.toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        return {
          ...r,
          time: timeStr,
          powerkW: parseFloat((r.power / 1000).toFixed(4)),
          voltageV: r.voltage,
          currentA: r.current,
          energyKWh: r.energy,
        };
      })
      .reverse(); // Standard chronological order
  }

  const groups: { [key: string]: PowerReading[] } = {};
  readingsList.forEach(r => {
    const date = getReadingDate(r);
    let key = "";
    if (groupBy === "hour") {
      // Grouping key: "YYYY-MM-DD HH:00"
      const yr = date.getFullYear();
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      const dy = String(date.getDate()).padStart(2, "0");
      const hr = String(date.getHours()).padStart(2, "0");
      key = `${yr}-${mo}-${dy} ${hr}:00`;
    } else {
      // Grouping key: "YYYY-MM-DD"
      const yr = date.getFullYear();
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      const dy = String(date.getDate()).padStart(2, "0");
      key = `${yr}-${mo}-${dy}`;
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(r);
  });

  // Convert map to sorted array
  const aggregated = Object.keys(groups).map(key => {
    const items = groups[key];
    const count = items.length;
    const avgPower = items.reduce((sum, item) => sum + item.power, 0) / count;
    const avgVoltage = items.reduce((sum, item) => sum + item.voltage, 0) / count;
    const avgCurrent = items.reduce((sum, item) => sum + item.current, 0) / count;
    // Cumulative energy - take the max reading in this interval representing cumulative consumption
    const maxEnergy = Math.max(...items.map(item => item.energy));

    // Format display date labels
    let displayTime = key;
    if (groupBy === "hour") {
      const parts = key.split(" ");
      const dateParts = parts[0].split("-");
      const timePart = parts[1];
      const dayVal = parseInt(dateParts[2]);
      const monthTh = getThaiMonthShort(parseInt(dateParts[1]) - 1);
      displayTime = `${timePart} (${dayVal} ${monthTh})`;
    } else {
      const dateParts = key.split("-");
      const dayVal = parseInt(dateParts[2]);
      const monthTh = getThaiMonthShort(parseInt(dateParts[1]) - 1);
      const yearCE = parseInt(dateParts[0]);
      displayTime = `${dayVal} ${monthTh} ${yearCE + 543}`; // Buddhist Era
    }

    return {
      time: displayTime,
      powerkW: parseFloat((avgPower / 1000).toFixed(4)),
      voltageV: parseFloat(avgVoltage.toFixed(1)),
      currentA: parseFloat(avgCurrent.toFixed(3)),
      energyKWh: parseFloat(maxEnergy.toFixed(4)),
      key, // for sorting
    };
  });

  // Chronological order
  return aggregated.sort((a, b) => a.key.localeCompare(b.key));
};

export default function ChartSection({
  data,
  isDarkMode = true,
  historyFilter,
  setHistoryFilter,
  selectedBillingPeriodIndex,
  setSelectedBillingPeriodIndex,
  getBillingPeriodsList,
}: ChartSectionProps) {
  const [metricTab, setMetricTab] = useState<"power" | "voltage_current" | "energy">("power");

  // The telemetry data passed is already filtered in App.tsx according to selected timeframe, search query, and device filters!
  const filteredByTime = data;

  // Determine optimal aggregation interval based on the active history filter
  const optimalGroupBy = useMemo(() => {
    if (historyFilter === "all") {
      return filteredByTime.length > 100 ? "hour" : "none";
    }
    if (historyFilter === "today") {
      return "none"; // Detailed view for today
    }
    if (historyFilter === "yesterday") {
      return "none"; // Detailed view for yesterday
    }
    if (historyFilter === "7days") {
      return "hour"; // Show hourly averages for last 7 days
    }
    if (historyFilter === "1month") {
      return "day"; // Show daily averages for last month
    }
    if (historyFilter === "billing") {
      if (filteredByTime.length > 300) return "day";
      if (filteredByTime.length > 50) return "hour";
      return "none";
    }
    return "none";
  }, [historyFilter, filteredByTime.length]);

  // Apply aggregation to format data for charts
  const formattedData = useMemo(() => {
    return aggregateData(filteredByTime, optimalGroupBy);
  }, [filteredByTime, optimalGroupBy]);

  // Calculate Min, Max, and Avg for active metrics in the current timeframe
  const stats = useMemo(() => {
    if (formattedData.length === 0) return null;

    if (metricTab === "power") {
      const powers = formattedData.map(d => d.powerkW);
      const min = Math.min(...powers);
      const max = Math.max(...powers);
      const avg = powers.reduce((sum, v) => sum + v, 0) / powers.length;
      return {
        dual: false,
        min: min,
        max: max,
        avg: avg,
        unit: "kW",
        label: "กำลังไฟฟ้าเฉลี่ย",
        colorClass: "text-emerald-500"
      };
    } else if (metricTab === "voltage_current") {
      const voltages = formattedData.map(d => d.voltageV);
      const currents = formattedData.map(d => d.currentA);
      
      const minV = Math.min(...voltages);
      const maxV = Math.max(...voltages);
      const avgV = voltages.reduce((sum, v) => sum + v, 0) / voltages.length;
      
      const minI = Math.min(...currents);
      const maxI = Math.max(...currents);
      const avgI = currents.reduce((sum, v) => sum + v, 0) / currents.length;
      
      return {
        dual: true,
        v: { min: minV, max: maxV, avg: avgV, unit: "V", label: "แรงดัน (Volt)", colorClass: "text-blue-500" },
        i: { min: minI, max: maxI, avg: avgI, unit: "A", label: "กระแส (Amp)", colorClass: "text-amber-500" }
      };
    } else {
      const energies = formattedData.map(d => d.energyKWh);
      const min = Math.min(...energies);
      const max = Math.max(...energies);
      const avg = energies.reduce((sum, v) => sum + v, 0) / energies.length;
      return {
        dual: false,
        min: min,
        max: max,
        avg: avg,
        unit: "kWh",
        label: "หน่วยสะสมรวม",
        colorClass: "text-violet-500"
      };
    }
  }, [formattedData, metricTab]);

  // Custom Tooltip component
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className={`p-3.5 rounded-2xl border text-xs shadow-xl font-mono ${
          isDarkMode 
            ? "bg-zinc-950 text-white border-zinc-800" 
            : "bg-white text-zinc-900 border-zinc-200"
        }`}>
          <p className={`${isDarkMode ? "text-zinc-500" : "text-zinc-400"} font-bold mb-1.5`}>{label}</p>
          {payload.map((p: any) => (
            <div key={p.name} className="flex justify-between gap-6 py-0.5">
              <span style={{ color: p.color || p.stroke }} className="font-semibold">{p.name}:</span>
              <span className={`font-extrabold ${isDarkMode ? "text-zinc-100" : "text-zinc-800"}`}>{p.value} {p.unit || ""}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`rounded-3xl p-6 shadow-xl space-y-5 transition-all duration-300 border ${
      isDarkMode 
        ? "bg-zinc-900 border-zinc-800 text-zinc-100 shadow-zinc-950/25" 
        : "bg-white border-zinc-200 text-zinc-800 shadow-zinc-200/50"
    }`} id="charts-container">
      {/* Chart Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className={`font-semibold text-base flex items-center gap-1.5 ${isDarkMode ? "text-white" : "text-zinc-900"}`}>
            <Activity className="w-5 h-5 text-emerald-500 fill-emerald-500/20 drop-shadow-[0_0_4px_rgba(16,185,129,0.25)]" />
            วิเคราะห์เทรนด์กำลังไฟ (Telemetry Charts)
          </h3>
          <p className={`text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>แสดงผลวิเคราะห์แนวโน้มไฟฟ้าสถิติย้อนหลังและเรียลไทม์</p>
        </div>

        {/* Metric View Tabs */}
        <div className={`flex p-1 rounded-xl border w-fit ${
          isDarkMode ? "bg-black/40 border-zinc-800/80" : "bg-zinc-100 border-zinc-200"
        }`} id="metric-tabs">
          <button
            onClick={() => setMetricTab("power")}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              metricTab === "power"
                ? isDarkMode
                  ? "bg-zinc-800 text-emerald-400 border border-zinc-700/50 shadow-sm"
                  : "bg-white text-emerald-600 border border-zinc-200 shadow-sm"
                : isDarkMode
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            <Zap className={`w-3.5 h-3.5 transition-all duration-300 ${metricTab === 'power' ? 'text-emerald-500 dark:text-emerald-400 fill-emerald-500/25 scale-110' : 'text-zinc-400'}`} /> กำลังไฟ (kW)
          </button>
          <button
            onClick={() => setMetricTab("voltage_current")}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              metricTab === "voltage_current"
                ? isDarkMode
                  ? "bg-zinc-800 text-blue-400 border border-zinc-700/50 shadow-sm"
                  : "bg-white text-blue-600 border border-zinc-200 shadow-sm"
                : isDarkMode
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            <TrendingUp className={`w-3.5 h-3.5 transition-all duration-300 ${metricTab === 'voltage_current' ? 'text-blue-500 dark:text-blue-400 fill-blue-500/25 scale-110' : 'text-zinc-400'}`} /> Volts & Amps
          </button>
          <button
            onClick={() => setMetricTab("energy")}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              metricTab === "energy"
                ? isDarkMode
                  ? "bg-zinc-800 text-violet-400 border border-zinc-700/50 shadow-sm"
                  : "bg-white text-violet-600 border border-zinc-200 shadow-sm"
                : isDarkMode
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            <Layers className={`w-3.5 h-3.5 transition-all duration-300 ${metricTab === 'energy' ? 'text-violet-500 dark:text-violet-400 fill-violet-500/25 scale-110' : 'text-zinc-400'}`} /> หน่วยสะสม (kWh)
          </button>
        </div>
      </div>

      {/* Timeframe selector toolbar */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 rounded-2xl border ${
        isDarkMode ? "bg-black/20 border-zinc-800/50" : "bg-zinc-50 border-zinc-200"
      }`} id="chart-filters-bar">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setHistoryFilter("all")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              historyFilter === "all"
                ? isDarkMode
                  ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm"
                  : "bg-white text-zinc-800 border border-zinc-200 shadow-sm"
                : isDarkMode
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "text-zinc-400 hover:text-zinc-700"
            }`}
          >
            ทั้งหมด
          </button>
          <button
            onClick={() => setHistoryFilter("today")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              historyFilter === "today"
                ? isDarkMode
                  ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm"
                  : "bg-white text-zinc-800 border border-zinc-200 shadow-sm"
                : isDarkMode
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "text-zinc-400 hover:text-zinc-700"
            }`}
          >
            วันนี้
          </button>
          <button
            onClick={() => setHistoryFilter("yesterday")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              historyFilter === "yesterday"
                ? isDarkMode
                  ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm"
                  : "bg-white text-zinc-800 border border-zinc-200 shadow-sm"
                : isDarkMode
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "text-zinc-400 hover:text-zinc-700"
            }`}
          >
            เมื่อวาน
          </button>
          <button
            onClick={() => setHistoryFilter("7days")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              historyFilter === "7days"
                ? isDarkMode
                  ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm"
                  : "bg-white text-zinc-800 border border-zinc-200 shadow-sm"
                : isDarkMode
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "text-zinc-400 hover:text-zinc-700"
            }`}
          >
            7 วันล่าสุด
          </button>
          <button
            onClick={() => setHistoryFilter("1month")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              historyFilter === "1month"
                ? isDarkMode
                  ? "bg-zinc-800 text-white border border-zinc-700/50 shadow-sm"
                  : "bg-white text-zinc-800 border border-zinc-200 shadow-sm"
                : isDarkMode
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "text-zinc-400 hover:text-zinc-700"
            }`}
          >
            1 เดือนล่าสุด
          </button>
          <button
            onClick={() => setHistoryFilter("billing")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              historyFilter === "billing"
                ? isDarkMode
                  ? "bg-zinc-800 text-emerald-400 border border-zinc-700/50 shadow-sm font-bold"
                  : "bg-white text-emerald-600 border border-zinc-200 shadow-sm font-bold"
                : isDarkMode
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "text-zinc-400 hover:text-zinc-750"
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-emerald-500" />
            เลือกตามรอบบิล
          </button>
        </div>

        {/* Aggregation interval status badge */}
        <div className={`flex items-center gap-1 text-[10px] font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
          <Info className={`w-3 h-3 ${isDarkMode ? "text-zinc-600" : "text-zinc-400"}`} />
          <span>การจัดกลุ่มข้อมูล: </span>
          <span className={`font-bold ${isDarkMode ? "text-zinc-400" : "text-zinc-700"}`}>
            {optimalGroupBy === "none" ? "ข้อมูลดิบ" : optimalGroupBy === "hour" ? "รายชั่วโมง" : "รายวัน"}
          </span>
        </div>
      </div>

      {/* Sync with Billing Cycle select from App.tsx */}
      {historyFilter === "billing" && (
        <div className={`p-4 rounded-2xl border animate-in fade-in duration-200 flex flex-col sm:flex-row sm:items-center gap-3 ${
          isDarkMode ? "bg-zinc-950/40 border-zinc-800/80" : "bg-zinc-100/60 border-zinc-200"
        }`} id="custom-billing-picker">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold font-mono ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>เลือกรอบบิล (Select Billing Period):</span>
            <select
              value={selectedBillingPeriodIndex}
              onChange={(e) => setSelectedBillingPeriodIndex(Number(e.target.value))}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl border focus:outline-none transition-all ${
                isDarkMode 
                  ? "bg-black/60 border-zinc-800 text-zinc-300 focus:ring-zinc-700" 
                  : "bg-white border-zinc-200 text-zinc-700 focus:ring-emerald-500 shadow-sm"
              }`}
            >
              {getBillingPeriodsList().map((period, idx) => (
                <option key={idx} value={idx}>{period.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Render chart canvas or fallback empty states */}
      {data.length === 0 ? (
        <div className={`h-[300px] flex flex-col items-center justify-center rounded-2xl border border-dashed ${
          isDarkMode ? "bg-black/30 border-zinc-800" : "bg-zinc-50 border-zinc-200"
        }`}>
          <Activity className={`w-10 h-10 animate-pulse mb-2 ${isDarkMode ? "text-zinc-600" : "text-zinc-300"}`} />
          <p className={`text-sm font-semibold ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>ยังไม่มีข้อมูลเพียงพอสำหรับวิเคราะห์กราฟ</p>
          <p className={`text-xs mt-1 font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>LOG_STREAMING_PENDING...</p>
        </div>
      ) : formattedData.length === 0 ? (
        <div className={`h-[300px] flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center ${
          isDarkMode ? "bg-black/30 border-zinc-800" : "bg-zinc-50 border-zinc-200"
        }`}>
          <Calendar className={`w-10 h-10 animate-bounce mb-3 ${isDarkMode ? "text-zinc-600" : "text-zinc-300"}`} />
          <p className={`text-sm font-semibold ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>ไม่พบข้อมูลในช่วงเวลาที่ระบุ</p>
          <p className={`text-xs mt-1 ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>ลองเปลี่ยนช่วงเวลา filter เพื่อแสดงข้อมูลอื่น</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Quick Metrics Statistics Bar */}
          {stats && (
            <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl border transition-all duration-300 ${
              isDarkMode ? "bg-black/20 border-zinc-800/80" : "bg-zinc-50 border-zinc-200"
            }`}>
              {!stats.dual ? (
                <>
                  <div className="text-left">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>ค่าต่ำสุด (Minimum)</span>
                    <p className={`text-base font-extrabold font-mono mt-0.5 ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
                      {stats.min.toFixed(4)} <span className="text-xs text-zinc-500 font-sans">{stats.unit}</span>
                    </p>
                  </div>
                  <div className={`text-left border-t sm:border-t-0 sm:border-l sm:pl-4 pt-2 sm:pt-0 ${isDarkMode ? "border-zinc-800/60" : "border-zinc-200"}`}>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>ค่าเฉลี่ย (Average)</span>
                    <p className={`text-base font-extrabold font-mono mt-0.5 ${stats.colorClass}`}>
                      {stats.avg.toFixed(4)} <span className="text-xs text-zinc-550 font-sans">{stats.unit}</span>
                    </p>
                  </div>
                  <div className={`text-left border-t sm:border-t-0 sm:border-l sm:pl-4 pt-2 sm:pt-0 ${isDarkMode ? "border-zinc-800/60" : "border-zinc-200"}`}>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>ค่าสูงสุด (Maximum)</span>
                    <p className={`text-base font-extrabold font-mono mt-0.5 ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
                      {stats.max.toFixed(4)} <span className="text-xs text-zinc-500 font-sans">{stats.unit}</span>
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-left sm:col-span-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>แรงดันไฟฟ้าเฉลี่ย (Avg Volt)</span>
                    <p className="text-base font-extrabold font-mono text-blue-500 mt-0.5">
                      {stats.v.avg.toFixed(1)} <span className="text-xs text-zinc-500 font-sans">V</span>
                    </p>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      (ต่ำสุด: {stats.v.min.toFixed(1)}V | สูงสุด: {stats.v.max.toFixed(1)}V)
                    </span>
                  </div>
                  <div className={`text-left border-t sm:border-t-0 sm:border-l sm:pl-4 pt-2 sm:pt-0 sm:col-span-1 ${isDarkMode ? "border-zinc-800/60" : "border-zinc-200"}`}>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>กระแสไฟฟ้าเฉลี่ย (Avg Amp)</span>
                    <p className="text-base font-extrabold font-mono text-amber-500 mt-0.5">
                      {stats.i.avg.toFixed(3)} <span className="text-xs text-zinc-500 font-sans">A</span>
                    </p>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      (ต่ำสุด: {stats.i.min.toFixed(3)}A | สูงสุด: {stats.i.max.toFixed(3)}A)
                    </span>
                  </div>
                  <div className={`text-left border-t sm:border-t-0 sm:border-l sm:pl-4 pt-2 sm:pt-0 sm:col-span-1 ${isDarkMode ? "border-zinc-800/60" : "border-zinc-200"}`}>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>แพ็กเก็ตตัวอย่าง (Sample Size)</span>
                    <p className={`text-base font-extrabold font-mono mt-0.5 ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
                      {formattedData.length} <span className="text-xs text-zinc-500 font-sans">pts</span>
                    </p>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      (ช่วงเวลา: {optimalGroupBy === "none" ? "ข้อมูลดิบ" : optimalGroupBy === "hour" ? "รายชั่วโมง" : "รายวัน"})
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="h-[320px] w-full" id="chart-canvas-container">
            <ResponsiveContainer width="100%" height="100%">
              {metricTab === "power" ? (
                <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPower" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#27272a" : "#e4e4e7"} />
                  <XAxis dataKey="time" stroke={isDarkMode ? "#71717a" : "#a1a1aa"} fontSize={10} tickLine={false} />
                  <YAxis stroke={isDarkMode ? "#71717a" : "#a1a1aa"} fontSize={10} tickLine={false} unit="kW" />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    name="กำลังไฟฟ้าเฉลี่ย"
                    type="monotone"
                    dataKey="powerkW"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorPower)"
                    unit=" kW"
                    isAnimationActive={false}
                  />
                </AreaChart>
              ) : metricTab === "voltage_current" ? (
                <LineChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#27272a" : "#e4e4e7"} />
                  <XAxis dataKey="time" stroke={isDarkMode ? "#71717a" : "#a1a1aa"} fontSize={10} tickLine={false} />
                  <YAxis yAxisId="left" stroke="#3b82f6" fontSize={10} tickLine={false} unit="V" />
                  <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={10} tickLine={false} unit="A" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: isDarkMode ? '#a1a1aa' : '#52525b', paddingTop: 10 }} />
                  <Line
                    yAxisId="left"
                    name="แรงดันไฟฟ้าเฉลี่ย (Voltage)"
                    type="monotone"
                    dataKey="voltageV"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    unit=" V"
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="right"
                    name="กระแสไฟฟ้าเฉลี่ย (Current)"
                    type="monotone"
                    dataKey="currentA"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    unit=" A"
                    isAnimationActive={false}
                  />
                </LineChart>
              ) : (
                <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#27272a" : "#e4e4e7"} />
                  <XAxis dataKey="time" stroke={isDarkMode ? "#71717a" : "#a1a1aa"} fontSize={10} tickLine={false} />
                  <YAxis stroke={isDarkMode ? "#71717a" : "#a1a1aa"} fontSize={10} tickLine={false} unit="kWh" />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    name="พลังงานสะสมสูงสุด"
                    type="monotone"
                    dataKey="energyKWh"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorEnergy)"
                    unit=" kWh"
                    isAnimationActive={false}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
