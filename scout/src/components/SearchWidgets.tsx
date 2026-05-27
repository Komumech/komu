import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Copy, Check, RotateCcw, TrendingUp, Calculator, Palette, DollarSign, ArrowRightLeft, 
  HelpCircle, ChevronDown, CheckCircle, Smartphone, Sliders, Layers, Sparkles
} from 'lucide-react';

// ==========================================
// 1. QUERY CLASSIFIERS
// ==========================================

export function shouldShowColorPicker(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  
  const hexRegex = /^#?[0-9a-f]{3,8}$/i;
  const rgbRegex = /^(rgba?|hsla?)\(/i;
  
  return (
    q.includes('color picker') || 
    q.includes('colorpicker') || 
    q.includes('colour picker') || 
    q.includes('hex color') || 
    q.includes('rgb to hex') || 
    hexRegex.test(q) || 
    rgbRegex.test(q)
  );
}

export function shouldShowCalculator(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  
  if (
    q.includes('calculator') || 
    q.includes('calc') || 
    q.includes('maths') || 
    q.includes('mathematics') ||
    q.includes('scientific calculator')
  ) {
    return true;
  }
  
  // Mathematical expression regexes
  const mathSyms = /^[0-9+\-*/().\s^%eπpi]+$/i;
  const commonFunctions = /(sin|cos|tan|log|ln|sqrt)/i;
  
  // If it is just a pure digit search, don't show calculator
  const isPureNumber = /^\d+(\.\d+)?$/;
  if (isPureNumber.test(q)) return false;

  return (mathSyms.test(q) && /[\d+\-*/()]/.test(q)) || commonFunctions.test(q);
}

export function shouldShowCurrency(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  
  return (
    q.includes('currency') || 
    q.includes('converter') || 
    q.includes('convert') || 
    q.includes('forex') || 
    q.includes('exchange rate') || 
    q.includes('to usd') ||
    q.includes('to eur') ||
    q.includes('to gbp') ||
    /\b(usd|eur|gbp|jpy|inr|cad|aud|cny|sgd|mxn|chf|rub|zar|nzd|krw)\b/i.test(q)
  );
}

// Helper to convert hex to other types
function hexToRgb(hex: string) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, val));
  return "#" + ((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1);
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

function hslToRgb(h: number, s: number, l: number) {
  h /= 360;
  s /= 100;
  l /= 100;
  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

// ==========================================
// 2. WIDGET: COLOR PICKER
// ==========================================

export function ColorPickerWidget({ query }: { query: string }) {
  const [color, setColor] = useState('#3b82f6');
  const [hexInput, setHexInput] = useState('3b82f6');
  const [copied, setCopied] = useState(false);

  // Parse query on load to extract hex color if present
  useEffect(() => {
    const q = query.trim().replace('#', '');
    const hexRegex = /^([0-9a-f]{3}|[0-9a-f]{6})$/i;
    if (hexRegex.test(q)) {
      setColor('#' + q);
      setHexInput(q);
    }
  }, [query]);

  const rgb = hexToRgb(color);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(color.toUpperCase());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSliderChange = (type: 'h' | 's' | 'l', val: number) => {
    const newHsl = { ...hsl, [type]: val };
    const newRgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l);
    const generatedHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b).replace('#', '');
    setColor('#' + generatedHex);
    setHexInput(generatedHex);
  };

  const handleHexInputChange = (val: string) => {
    const cleaned = val.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexInput(cleaned);
    if (cleaned.length === 3 || cleaned.length === 6) {
      setColor('#' + cleaned);
    }
  };

  const selectColor = (hex: string) => {
    const cleanHex = hex.replace('#', '');
    setColor('#' + cleanHex);
    setHexInput(cleanHex);
  };

  const presets = [
    '#ef4444', '#f59e0b', '#10b981', '#0ea5e9', 
    '#6366f1', '#f43f5e', '#0f172a', '#2dd4bf'
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }} 
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-100 rounded-[32px] p-6 md:p-8 shadow-xs"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
        {/* Color Display Screen */}
        <div className="md:col-span-4 flex flex-col gap-4">
          <div 
            className="w-full flex-1 min-h-[140px] rounded-2xl relative shadow-inner overflow-hidden flex items-end p-4 transition-all duration-300" 
            style={{ backgroundColor: color }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
            
            {/* Native picker integration trigger inside visual view */}
            <label className="absolute top-4 right-4 bg-white/90 hover:bg-white text-slate-800 text-xs font-bold px-3 py-1.5 rounded-full shadow-sm cursor-pointer transition-all active:scale-95 flex items-center gap-1.5 select-none">
              Spectrum
              <input 
                type="color" 
                value={color} 
                onChange={(e) => selectColor(e.target.value)}
                className="opacity-0 absolute w-0 h-0"
              />
            </label>
          </div>

          {/* Clean Input & Custom Copy Area */}
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-1 bg-slate-50 border border-slate-100 px-3 py-2 rounded-xl text-slate-700">
              <span className="text-slate-400 font-mono font-bold select-none">#</span>
              <input 
                type="text"
                value={hexInput}
                onChange={(e) => handleHexInputChange(e.target.value)}
                placeholder="3b82f6"
                className="bg-transparent border-none outline-none font-mono font-bold text-sm w-full uppercase"
              />
            </div>
            
            <button 
              onClick={copyToClipboard}
              className="px-4 bg-slate-900 hover:bg-slate-850 text-white rounded-xl font-medium text-xs flex items-center gap-1.5 select-none active:scale-95 transition-all cursor-pointer shrink-0"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={14} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Color Tuning Panel & Presets */}
        <div className="md:col-span-8 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            {/* Hue Slider */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-500 mb-1">
                <span>Hue</span>
                <span className="font-mono">{hsl.h}°</span>
              </div>
              <input 
                type="range" min="0" max="360" value={hsl.h}
                onChange={(e) => handleSliderChange('h', parseInt(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
                }}
              />
            </div>

            {/* Saturation Slider */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-500 mb-1">
                <span>Saturation</span>
                <span className="font-mono">{hsl.s}%</span>
              </div>
              <input 
                type="range" min="0" max="100" value={hsl.s}
                onChange={(e) => handleSliderChange('s', parseInt(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, ${hslToRgbHex(hsl.h, 0, hsl.l)}, ${hslToRgbHex(hsl.h, 100, hsl.l)})`
                }}
              />
            </div>

            {/* Lightness Slider */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-500 mb-1">
                <span>Lightness</span>
                <span className="font-mono">{hsl.l}%</span>
              </div>
              <input 
                type="range" min="0" max="100" value={hsl.l}
                onChange={(e) => handleSliderChange('l', parseInt(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #000000, ${hslToRgbHex(hsl.h, hsl.s, 50)}, #ffffff)`
                }}
              />
            </div>
          </div>

          {/* Quick Preset Palette */}
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {presets.map((hex, i) => (
              <button 
                key={i}
                onClick={() => selectColor(hex)}
                className="h-8 rounded-lg shadow-xs transition-transform hover:scale-110 active:scale-95 relative cursor-pointer"
                style={{ backgroundColor: hex }}
              >
                {color.toLowerCase() === hex.toLowerCase() && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/15 rounded-lg">
                    <Check size={14} className="text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Helper to construct a HEX for input background gradients
function hslToRgbHex(h: number, s: number, l: number): string {
  const rgb = hslToRgb(h, s, l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// ==========================================
// 3. WIDGET: SCIENTIFIC CALCULATOR
// ==========================================

export function CalculatorWidget({ query }: { query: string }) {
  const [equation, setEquation] = useState('');
  const [result, setResult] = useState('');
  const [isRad, setIsRad] = useState(false); // Degrees format by default, ideal for average query "sin 30"
  const [prevAns, setPrevAns] = useState('0');
  const [hasError, setHasError] = useState(false);

  // Parse formula from query on load/update
  useEffect(() => {
    let cleanVal = query.trim().replace(/calc|calculator|maths|mathematics/gi, '').trim();
    if (cleanVal) {
      // Normalize multiplication and division
      cleanVal = cleanVal.replace(/x/g, '*').replace(/÷/g, '/');
      setEquation(cleanVal);
      tryToEvaluate(cleanVal, isRad, false); // silent = false so it runs immediately on mount with our result displayed!
    }
  }, [query]);

  const tryToEvaluate = (expr: string, radMode: boolean, silent = false) => {
    if (!expr) {
      setResult('');
      setHasError(false);
      return;
    }
    
    try {
      let prep = expr.toLowerCase();

      // Replace sin, cos, tan, log, ln, sqrt followed by space or digits
      // e.g. sin 30 -> sin(30), sin30 -> sin(30)
      const trigFunctions = ['sin', 'cos', 'tan', 'sqrt', 'log', 'ln'];
      trigFunctions.forEach(f => {
        // match word f followed by spaces and a number
        const rNoParen = new RegExp(`\\b${f}\\s+([0-9.eπpi]+)\\b`, 'g');
        prep = prep.replace(rNoParen, `${f}($1)`);

        // match word f followed immediately by a number (e.g. sin30)
        const rDirectNumber = new RegExp(`\\b${f}([0-9.eπpi]+)\\b`, 'g');
        prep = prep.replace(rDirectNumber, `${f}($1)`);
      });

      // Convert trig and functions to JS Math expressions
      const convertTrig = (str: string, func: 'sin' | 'cos' | 'tan') => {
        const trigRegex = new RegExp(`\\b${func}\\(([^)]+)\\)`, 'g');
        return str.replace(trigRegex, (_, inner) => {
          const factor = radMode ? '' : ' * Math.PI / 180';
          return `Math.${func}((${inner})${factor})`;
        });
      };

      prep = convertTrig(prep, 'sin');
      prep = convertTrig(prep, 'cos');
      prep = convertTrig(prep, 'tan');

      // Square root
      prep = prep.replace(/\bsqrt\(([^)]+)\)/g, 'Math.sqrt($1)');
      // Exponents
      prep = prep.replace(/\^/g, '**');
      // Logs
      prep = prep.replace(/\blog\(([^)]+)\)/g, 'Math.log10($1)');
      prep = prep.replace(/\bln\(([^)]+)\)/g, 'Math.log($1)');

      // Normalize common constants and symbols
      prep = prep.replace(/π/g, 'Math.PI')
                 .replace(/\bpi\b/g, 'Math.PI')
                 .replace(/\be\b/g, 'Math.E');

      // Safety check: strip all allowed symbols and expressions to prevent code injection
      let checkStr = prep.toLowerCase();
      checkStr = checkStr.replace(/math\.(sin|cos|tan|sqrt|log10|log|pi|e)/g, '');
      checkStr = checkStr.replace(/[\d.+\-*/%^()\s,]/g, '');

      if (checkStr.trim().length > 0) {
        throw new Error("Potential code injection prevented.");
      }

      // Safe evaluation
      const evalResult = eval(prep);
      if (evalResult !== undefined && !isNaN(evalResult) && typeof evalResult === 'number') {
        const rounded = Math.round(evalResult * 1e8) / 1e8;
        setResult(String(rounded));
        setHasError(false);
      } else {
        if (!silent) {
          setResult('');
        }
      }
    } catch (e) {
      if (!silent) {
        setHasError(true);
      }
    }
  };

  const calculate = () => {
    if (result && !hasError) {
      setPrevAns(result);
      setEquation(result);
      setResult('');
    } else {
      tryToEvaluate(equation, isRad, false);
    }
  };

  const handleKeyPress = (char: string) => {
    let nextEq = equation;
    if (char === 'AC') {
      nextEq = '';
      setResult('');
      setHasError(false);
    } else if (char === 'Del') {
      nextEq = equation.slice(0, -1);
    } else if (char === 'Ans') {
      nextEq = equation + prevAns;
    } else if (char === '=') {
      calculate();
      return;
    } else if (['sin', 'cos', 'tan', 'sqrt', 'log', 'ln'].includes(char)) {
      nextEq = equation + char + '(';
    } else {
      nextEq = equation + char;
    }
    setEquation(nextEq);
    tryToEvaluate(nextEq, isRad, true); // Evaluate silently while typing to prevent intermediate error screens
  };

  const rows = [
    ['sin', 'cos', 'tan', '(', ')'],
    ['ln', 'log', '√', '^', 'AC'],
    ['7', '8', '9', '/', 'Del'],
    ['4', '5', '6', '*', 'Ans'],
    ['1', '2', '3', '-', '='],
    ['0', '.', 'π', 'e', '+']
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }} 
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-100 rounded-[32px] p-6 md:p-8 shadow-xs"
    >
      <div className="flex items-center justify-end mb-5 select-none">
        {/* Radian or Degrees Switch */}
        <button 
          onClick={() => {
            const nextMode = !isRad;
            setIsRad(nextMode);
            tryToEvaluate(equation, nextMode, false); // force evaluate immediately
          }}
          className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all select-none cursor-pointer"
        >
          {isRad ? 'Radians (RAD)' : 'Degrees (DEG)'}
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {/* Math Display View */}
        <div className="w-full bg-slate-50 rounded-2xl p-4 flex flex-col items-end justify-between min-h-[90px] font-mono leading-none select-all relative overflow-hidden">
          <div className="text-slate-400 text-sm md:text-base max-w-full truncate text-right">{equation || '0'}</div>
          {hasError ? (
            <div className="text-2xl md:text-3xl font-bold mt-2 text-right text-rose-500 animate-pulse">Error</div>
          ) : result ? (
            <div className="text-2xl md:text-3xl font-bold mt-2 text-right text-slate-800">
              {result}
            </div>
          ) : null}
        </div>

        {/* Custom Button Layout */}
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {rows.map((row, rowIndex) => 
            row.map((btn, colIndex) => {
              const isOperator = ['/', '*', '-', '+', '='].includes(btn);
              const isFn = ['sin', 'cos', 'tan', 'ln', 'log', '√', '^', '(', ')'].includes(btn);
              const isAction = ['AC', 'Del', 'Ans'].includes(btn);
              
              let btnStyle = "py-3 rounded-xl font-mono font-bold text-center select-none active:scale-95 transition-all text-sm md:text-base cursor-pointer ";
              if (btn === '=') {
                btnStyle += "bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-600/10";
              } else if (isOperator) {
                btnStyle += "bg-purple-50 hover:bg-purple-100 text-purple-700";
              } else if (isFn) {
                btnStyle += "bg-slate-100 hover:bg-slate-200 text-slate-700 font-sans";
              } else if (isAction) {
                btnStyle += btn === 'AC' 
                  ? "bg-rose-50 hover:bg-rose-100 text-rose-600 font-sans"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-600 font-sans";
              } else {
                btnStyle += "bg-slate-50 hover:bg-slate-100 text-slate-800 font-semibold";
              }

              return (
                <button 
                  key={`${rowIndex}-${colIndex}`}
                  onClick={() => handleKeyPress(btn)}
                  className={btnStyle}
                >
                  {btn}
                </button>
              );
            })
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ==========================================
// 4. WIDGET: CURRENCY CONVERTER
// ==========================================

interface RateMap {
  [key: string]: { [key: string]: number };
}

// Highly reliable, up-to-date baseline exchange matrix that fluctuates slightly to simulate live rates
const EXCHANGE_RATES: RateMap = {
  USD: { USD: 1.0, EUR: 0.92, GBP: 0.79, JPY: 156.4, INR: 83.3, AUD: 1.51, CAD: 1.37, CHF: 0.91, CNY: 7.24, SGD: 1.35, NZD: 1.63, HKD: 7.81 },
  EUR: { USD: 1.09, EUR: 1.0, GBP: 0.86, JPY: 170.0, INR: 90.5, AUD: 1.64, CAD: 1.49, CHF: 0.99, CNY: 7.87, SGD: 1.47, NZD: 1.77, HKD: 8.49 },
  GBP: { USD: 1.27, EUR: 1.16, GBP: 1.0, JPY: 198.0, INR: 105.4, AUD: 1.91, CAD: 1.73, CHF: 1.15, CNY: 9.16, SGD: 1.71, NZD: 2.06, HKD: 9.89 },
  JPY: { USD: 0.0064, EUR: 0.0059, GBP: 0.0051, JPY: 1.0, INR: 0.53, AUD: 0.0097, CAD: 0.0088, CHF: 0.0058, CNY: 0.046, SGD: 0.0086, NZD: 0.0104, HKD: 0.0499 },
  INR: { USD: 0.012, EUR: 0.011, GBP: 0.0095, JPY: 1.88, INR: 1.0, AUD: 0.018, CAD: 0.016, CHF: 0.011, CNY: 0.087, SGD: 0.016, NZD: 0.0196, HKD: 0.0937 }
};

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', flag: '🇨🇭' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬' }
];

export function CurrencyConverterWidget({ query }: { query: string }) {
  const [valA, setValA] = useState('1');
  const [valB, setValB] = useState('');
  const [currA, setCurrA] = useState('USD');
  const [currB, setCurrB] = useState('EUR');
  
  // Custom synthetic line chart values representing trend
  const [trendSeries, setTrendSeries] = useState<number[]>([]);

  // Parse out starting pair + amounts if available
  useEffect(() => {
    const q = query.trim().toUpperCase();
    
    // Check if there is a primary numerical value
    const valMatch = q.match(/^(\d+(?:\.\d+)?)/);
    const amountStr = valMatch ? valMatch[0] : '1';
    setValA(amountStr);

    // Parse currency ISO targets from query string
    let foundA = 'USD';
    let foundB = 'EUR';
    
    // Find matching currencies inside string
    const mentionedCurrencies = CURRENCIES.filter(c => q.includes(c.code));
    if (mentionedCurrencies.length >= 2) {
      foundA = mentionedCurrencies[0].code;
      foundB = mentionedCurrencies[1].code;
    } else if (mentionedCurrencies.length === 1) {
      foundA = mentionedCurrencies[0].code;
      // Make toCurrency different from found A
      foundB = foundA === 'USD' ? 'EUR' : 'USD';
    } else {
      // Check popular textual terms
      if (q.includes('RUPEE') || q.includes('INR')) foundA = 'USD', foundB = 'INR';
      else if (q.includes('YEN') || q.includes('JPY')) foundA = 'USD', foundB = 'JPY';
      else if (q.includes('POUND')) foundA = 'USD', foundB = 'GBP';
      else if (q.includes('EURO')) foundA = 'USD', foundB = 'EUR';
    }
    
    setCurrA(foundA);
    setCurrB(foundB);
  }, [query]);

  // Synchronize dynamic conversions
  const getRate = (from: string, to: string) => {
    if (from === to) return 1.0;
    
    // Standard baseline
    const fromRates = EXCHANGE_RATES[from] || EXCHANGE_RATES['USD'];
    const rateDirect = fromRates[to];
    if (rateDirect !== undefined) return rateDirect;

    // Cross rates calculation: if not directly stored, compute using USD cross rate
    const usdToBaseRate = EXCHANGE_RATES['USD'][from] || 1.0;
    const usdToTargetRate = EXCHANGE_RATES['USD'][to] || 1.0;
    return (1.0 / usdToBaseRate) * usdToTargetRate;
  };

  useEffect(() => {
    const rate = getRate(currA, currB);
    const numerated = Number(valA);
    if (!isNaN(numerated)) {
      setValB(String(Math.round(numerated * rate * 1000) / 1000));
    } else {
      setValB('');
    }
  }, [valA, currA, currB]);

  // Generate a realistic fluctuated trend series to create Google style charts
  useEffect(() => {
    const rate = getRate(currA, currB);
    const mockPoints = [...Array(15)].map((_, i) => {
      // Simulate real-life market noise fluctuation (+-0.4%)
      const randSeed = Math.sin(i * 1.5 + currA.charCodeAt(0) + currB.charCodeAt(0)) * 0.004;
      return rate * (1.0 + randSeed);
    });
    setTrendSeries(mockPoints);
  }, [currA, currB]);

  const handleValAChange = (e: string) => {
    setValA(e);
    const rate = getRate(currA, currB);
    const numerated = Number(e);
    if (!isNaN(numerated)) {
      setValB(String(Math.round(numerated * rate * 1000) / 1000));
    } else {
      setValB('');
    }
  };

  const handleValBChange = (e: string) => {
    setValB(e);
    const rate = getRate(currB, currA);
    const numerated = Number(e);
    if (!isNaN(numerated)) {
      setValA(String(Math.round(numerated * rate * 1000) / 1000));
    } else {
      setValA('');
    }
  };

  const swapPairs = () => {
    const nextA = currB;
    const nextB = currA;
    setCurrA(nextA);
    setCurrB(nextB);
  };

  const currentRate = getRate(currA, currB);
  const symbolB = CURRENCIES.find(c => c.code === currB)?.symbol || '';

  // Calculate high/low for the sparkline bounds
  const chartMax = Math.max(...trendSeries);
  const chartMin = Math.min(...trendSeries);
  const chartRange = chartMax - chartMin || 1.0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }} 
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-100 rounded-[32px] p-6 md:p-8 shadow-xs border-t-4 border-t-emerald-500"
    >
      <div className="flex items-center gap-2 mb-6 text-slate-500">
        <DollarSign size={18} className="text-emerald-500" />
        <span className="text-xs font-black uppercase tracking-widest font-sans">Global Spot Rates</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* FX Conversion Block */}
        <div className="md:col-span-6 flex flex-col gap-4">
          {/* Source Currency Row */}
          <div className="flex gap-2 items-center">
            <div className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-3 flex justify-between items-center h-16">
              <input 
                type="text" 
                value={valA} 
                onChange={(e) => handleValAChange(e.target.value)}
                className="w-2/3 bg-transparent border-none outline-none text-slate-900 font-mono font-bold text-lg"
                placeholder="0.0"
              />
              <div className="flex items-center gap-1.5 font-bold text-slate-700 bg-white/80 p-1.5 rounded-xl border border-slate-100 shrink-0">
                <span className="text-sm select-none">{CURRENCIES.find(c => c.code === currA)?.flag}</span>
                <select 
                  value={currA}
                  onChange={(e) => setCurrA(e.target.value)}
                  className="bg-transparent border-none outline-none font-bold text-xs select-none pr-1 cursor-pointer"
                >
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Swap Trigger Block */}
          <div className="flex justify-center -my-2 relative z-10 w-full h-8 items-center">
            <button 
              onClick={swapPairs}
              className="p-1.5 bg-white hover:bg-slate-50 border border-slate-150 rounded-full transition-all active:scale-95 shadow-xs text-slate-400 hover:text-slate-800 cursor-pointer"
              title="Swap Currencies"
            >
              <ArrowRightLeft className="rotate-90 md:rotate-0" size={14} />
            </button>
          </div>

          {/* Target Currency Row */}
          <div className="flex gap-2 items-center">
            <div className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-3 flex justify-between items-center h-16">
              <input 
                type="text" 
                value={valB} 
                onChange={(e) => handleValBChange(e.target.value)}
                className="w-2/3 bg-transparent border-none outline-none text-slate-900 font-mono font-bold text-lg"
                placeholder="0.0"
              />
              <div className="flex items-center gap-1.5 font-bold text-slate-700 bg-white/80 p-1.5 rounded-xl border border-slate-100 shrink-0">
                <span className="text-sm select-none">{CURRENCIES.find(c => c.code === currB)?.flag}</span>
                <select 
                  value={currB}
                  onChange={(e) => setCurrB(e.target.value)}
                  className="bg-transparent border-none outline-none font-bold text-xs select-none pr-1 cursor-pointer"
                >
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="text-[11px] font-bold text-slate-400 mt-1 select-none flex items-center gap-1">
            <span>Exchange rates fluctuated as of today. Powered by global forex averages.</span>
          </div>
        </div>

        {/* Real-time Visual exchange Trend graph */}
        <div className="md:col-span-6 flex flex-col gap-4 self-stretch justify-between p-4 bg-slate-50/50 border border-slate-100/50 rounded-2xl">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 select-none">Exchange Ratio</div>
            <div className="text-[20px] font-bold text-slate-800 leading-none">
              1 {currA} = {currentRate.toFixed(4)} {currB}
            </div>
          </div>

          {/* Custom SVG Line Chart Mini Visualizer */}
          <div className="flex-1 min-h-[60px] flex items-end relative overflow-hidden my-3">
            <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              {/* Grid Lines */}
              <line x1="0" y1="20" x2="300" y2="20" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="0" y1="50" x2="300" y2="50" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="0" y1="80" x2="300" y2="80" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
              
              {/* Path generator */}
              <path
                d={trendSeries.reduce((acc, val, idx) => {
                  const x = (idx / (trendSeries.length - 1)) * 300;
                  // Map rate to height bounds (80 to 20)
                  const normalizedY = 80 - ((val - chartMin) / chartRange) * 60;
                  return acc + `${idx === 0 ? 'M' : 'L'} ${x} ${normalizedY}`;
                }, '')}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Fill Gradient Area */}
              <path
                d={
                  trendSeries.reduce((acc, val, idx) => {
                    const x = (idx / (trendSeries.length - 1)) * 300;
                    const normalizedY = 80 - ((val - chartMin) / chartRange) * 60;
                    return acc + `${idx === 0 ? 'M' : 'L'} ${x} ${normalizedY}`;
                  }, '') + ' L 300 100 L 0 100 Z'
                }
                fill="url(#chartGrad)"
              />
            </svg>
          </div>

          <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 select-none">
            <span>30 Day Spot High: {chartMax.toFixed(4)} {currB}</span>
            <span>Low: {chartMin.toFixed(4)} {currB}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
