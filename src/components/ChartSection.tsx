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

export default function ChartSection({ data, isDarkMode = true }: ChartSectionProps) {
  const [metricTab, setMetricTab] = useState<"power" | "voltage_current" | "energy">("power");
  const [timeframe, setTimeframe] = useState<"all" | "today" | "yesterday" | "7days" | "30days" | "billing">("all");
  
  // States for custom billing date picker
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30); // Default to last 30 days
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0]; // Default to today
  });

  // Filter data based on selected timeframe
  const filteredByTime = useMemo(() => {
    return data.filter((d) => {
      const rDate = getReadingDate(d);
      
      if (timeframe === "all") {
        return true;
      }
      
      if (timeframe === "today") {
        const today = new Date();
        return (
          rDate.getDate() === today.getDate() &&
          rDate.getMonth() === today.getMonth() &&
          rDate.getFullYear() === today.getFullYear()
        );
      }
      
      if (timeframe === "yesterday") {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return (
          rDate.getDate() === yesterday.getDate() &&
          rDate.getMonth() === yesterday.getMonth() &&
          rDate.getFullYear() === yesterday.getFullYear()
        );
      }
      
      if (timeframe === "7days") {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        return rDate >= sevenDaysAgo;
      }
      
      if (timeframe === "30days") {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        return rDate >= thirtyDaysAgo;
      }
      
      if (timeframe === "billing") {
        if (!startDate) return true;
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        
        const end = endDate ? new Date(endDate) : new Date();
        end.setHours(23, 59, 59, 999);
        
        return rDate >= start && rDate <= end;
      }
      
      return true;
    });
  }, [data, timeframe, startDate, endDate]);

  // Determine optimal aggregation interval
  const optimalGroupBy = useMemo(() => {
    if (timeframe === "all") {
      return filteredByTime.length > 100 ? "hour" : "none";
    }
    if (timeframe === "today") {
      return "hour"; // Group today's data hourly
    }
    if (timeframe === "yesterday") {
      return "hour"; // Group yesterday's data hourly
    }
    if (timeframe === "7days") {
      return "day"; // Show daily bars/points
    }
    if (timeframe === "30days") {
      return "day"; // Show daily averages
    }
    if (timeframe === "billing") {
      if (!startDate || !endDate) return "day";
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 2) return "hour";
      return "day";
    }
    return "none";
  }, [timeframe, filteredByTime.length, startDate, endDate]);

  // Apply aggregation to format data for charts
  const formattedData = useMemo(() => {
    return aggregateData(filteredByTime, optimalGroupBy);
  }, [filteredByTime, optimalGroupBy]);

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
            onClick={() => setTimeframe("all")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              timeframe === "all"
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
            onClick={() => setTimeframe("today")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              timeframe === "today"
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
            onClick={() => setTimeframe("yesterday")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              timeframe === "yesterday"
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
            onClick={() => setTimeframe("7days")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              timeframe === "7days"
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
            onClick={() => setTimeframe("30days")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              timeframe === "30days"
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
            onClick={() => setTimeframe("billing")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              timeframe === "billing"
                ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 shadow-sm font-bold"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm font-bold"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
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

      {/* Custom Billing Date Range Picker */}
      {timeframe === "billing" && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl border animate-in fade-in duration-200 ${
          isDarkMode ? "bg-zinc-950/40 border-zinc-800/80" : "bg-zinc-100/60 border-zinc-200"
        }`} id="billing-cycle-picker">
          <div className="space-y-1">
            <label className={`text-[10px] font-bold uppercase tracking-wider block font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>เริ่มต้นรอบบิล (Start Date):</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`w-full text-xs font-semibold border rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono focus:border-transparent ${
                isDarkMode ? "bg-black/60 text-zinc-200 border-zinc-800" : "bg-white text-zinc-800 border-zinc-200"
              }`}
            />
          </div>
          <div className="space-y-1">
            <label className={`text-[10px] font-bold uppercase tracking-wider block font-mono ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>สิ้นสุดรอบบิล (End Date):</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`w-full text-xs font-semibold border rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono focus:border-transparent ${
                isDarkMode ? "bg-black/60 text-zinc-200 border-zinc-800" : "bg-white text-zinc-800 border-zinc-200"
              }`}
            />
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
          <p className={`text-xs mt-1 ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>ลองเปลี่ยนช่วงเวลา filter หรือเปิดปุ่มทำงานบน Simulator บอร์ดจำลองเพื่อส่งข้อมูลเข้ามา</p>
        </div>
      ) : (
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
      )}
    </div>
  );
}
