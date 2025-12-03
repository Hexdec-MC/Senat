import React, { useState, useEffect, useMemo } from 'react';
// Importamos la configuración local que creaste en el paso 4
import { db, auth } from './firebaseConfig'; 
import { signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { doc, collection, query, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, limit, writeBatch } from 'firebase/firestore';
import {
  Wrench, Package, Truck, Clock, AlertTriangle, UserPlus, LogIn, LogOut, Loader2, Save, X, Trash2, Edit2, Play, StopCircle, CheckCircle, BarChart3, Search, Plus, Users, History, ClipboardList, AlertOctagon, FileText, Printer, AlertCircle, ChevronRight, Fuel, Image as ImageIcon, Upload, Droplets, Bell, ListChecks, Box, XCircle, Menu, Lock, Settings, PlusCircle, Eye, Camera
} from 'lucide-react';

// --- CONFIGURACIÓN ---
const appId = 'heavy-machinery-app-v2';
// Nota: Aquí eliminamos la configuración dinámica que tenías antes (__firebase_config)
// ya que ahora importamos 'db' y 'auth' directamente arriba.

// --- UTILITIES ---
const getCollectionRef = (collectionName, userId) => {
    return collection(db, 'artifacts', appId, 'users', userId, collectionName);
};

const formatDuration = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours > 0) return `${hours}h ${remainingMinutes}m`;
    return `${minutes} min`;
};

// Función para comprimir imágenes (Evitar límite de 1MB de Firestore)
const compressImage = (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const MAX_HEIGHT = 800;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7)); // Compresión JPEG al 70%
            };
        };
    });
};

// --- CONSTANTES ---

const WARNING_THRESHOLD = 50;
const BLOCK_THRESHOLD = 15; // Margen de tolerancia para bloqueo de operación

const Circle = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>
);

const MACHINE_ICONS = [
    { id: 'excavator', label: 'Excavadora', icon: Truck }, 
    { id: 'loader', label: 'Cargador', icon: Package },
    { id: 'truck', label: 'Camión', icon: Truck },
    { id: 'roller', label: 'Rodillo', icon: Circle },
];

const PM_SEQUENCE = ['PM1', 'PM2', 'PM1', 'PM3', 'PM1', 'PM2', 'PM3', 'PM4'];
// Updated labels with exact hour milestones for clarity
const PM_CYCLE_LABELS = [
    'PM1 (250 hrs)',
    'PM2 (500 hrs)',
    'PM1 (750 hrs)',
    'PM3 (1000 hrs)',
    'PM1 (1250 hrs)',
    'PM2 (1500 hrs)',
    'PM3 (1750 hrs)',
    'PM4 (2000 hrs - Fin Ciclo)'
];
const PM_TYPES = ['PM1', 'PM2', 'PM3', 'PM4']; 

const DUMMY_AUTH_DB = [
    { id: 'admin1', username: 'admin', role: 'Administrador', password: '123' },
    { id: 'inst1', username: 'instructor', role: 'Instructor', password: '456' },
    { id: 'student1', username: 'estudiante', role: 'Estudiante', password: '789' },
];

const DUMMY_MACHINES = [
    { 
        id: 'M1', 
        name: 'Excavadora Cat 320', 
        model: '320D', 
        plate: 'CAT-001',
        current_hm: 5120, 
        fuel_level: 75, 
        next_pm_type: 'PM3', 
        next_pm_due_hm: 5370, 
        last_pm_type: 'PM1', 
        last_pm_hm: 5120, 
        is_in_use: false, 
        series: 'CGG305163', 
        next_pm_sequence_index: 3,
        image_type: 'preset',
        image_src: 'excavator' 
    },
    { 
        id: 'M2', 
        name: 'Cargador Frontal WA470', 
        model: 'WA470-6', 
        plate: 'KOM-992',
        current_hm: 260, 
        fuel_level: 40,
        next_pm_type: 'PM2', 
        next_pm_due_hm: 510, 
        last_pm_type: 'PM1', 
        last_pm_hm: 260, 
        is_in_use: false, 
        series: 'KAM47060021', 
        next_pm_sequence_index: 1,
        image_type: 'preset',
        image_src: 'loader'
    },
];

const DUMMY_SUPPLIES = [
    { id: 'S1', name: 'Aceite de Motor SAE 15W-40', stock: 150, unit: 'Litros' },
    { id: 'S2', name: 'Filtro de Aceite (Grande)', stock: 80, unit: 'Unidades' },
];

// --- CORE LOGIC ---

// Lógica de cálculo automático INTELIGENTE (Por proximidad y tolerancia de 25h)
const getRecommendedSequenceIndex = (currentHm) => {
    const milestones = [250, 500, 750, 1000, 1250, 1500, 1750, 2000];
    const relativeHm = currentHm % 2000;

    let nextIndex = 0; 

    for (let i = 0; i < milestones.length; i++) {
        const threshold = milestones[i] - 25; // Umbral de tolerancia REDUCIDO A 25H
        
        if (relativeHm >= threshold) {
            nextIndex = i + 1;
        } else {
            nextIndex = i;
            break; 
        }
    }
    
    return nextIndex % 8;
};

const calculateNextPmStep = (currentHmDone, currentSequenceIndex) => {
    const nextPmDueHm = currentHmDone + 250;
    const nextSequenceIndex = (currentSequenceIndex + 1) % 8;
    const nextPmType = PM_SEQUENCE[nextSequenceIndex];
    return { nextPmType, nextPmDueHm, nextSequenceIndex };
};

// --- COMPONENTES UI ---

// ... existing code ... (Loader, FuelGauge, GlobalToast, NotificationCenter, Modal, ConfirmationModal, MaintenanceReportTemplate, LoginScreen, DashboardOverview)
const Loader = () => (
    <div className="flex justify-center items-center h-[100dvh] text-indigo-600 flex-col bg-gray-50">
        <Loader2 className="animate-spin w-12 h-12 mb-4" />
        <span className="text-lg font-medium animate-pulse">Cargando Sistema...</span>
    </div>
);

const FuelGauge = ({ percentage }) => {
    let color = 'bg-green-500';
    if (percentage <= 20) color = 'bg-red-500';
    else if (percentage <= 50) color = 'bg-yellow-500';

    return (
        <div className="w-full">
            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-500">
                <span className="flex items-center"><Fuel className="w-3 h-3 mr-1"/> Nivel Combustible</span>
                <span>{percentage}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden border border-gray-300">
                <div className={`h-2.5 rounded-full ${color} transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
            </div>
        </div>
    );
};

const GlobalToast = ({ message, onClose }) => {
    if (!message) return null;
    return (
        <div className={`fixed z-[120] print:hidden animate-bounce-in
            top-20 left-4 right-4 md:top-auto md:left-auto md:bottom-8 md:right-8 md:w-auto
            max-w-md mx-auto md:mx-0
            px-6 py-4 rounded-2xl shadow-2xl backdrop-blur-md flex items-center justify-between
            ${message.type === 'success' ? 'bg-green-600/95 text-white shadow-green-900/20' : 'bg-red-600/95 text-white shadow-red-900/20'}
        `}>
            <div className="flex items-center mr-4">
                {message.type === 'success' ? <CheckCircle className="w-6 h-6 mr-3 shrink-0" /> : <AlertTriangle className="w-6 h-6 mr-3 shrink-0" />}
                <span className="font-bold text-sm md:text-base leading-tight">{message.text}</span>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full transition"><X className="w-5 h-5"/></button>
        </div>
    );
};

const NotificationCenter = ({ machines = [], supplies = [] }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    useEffect(() => {
        if (isOpen) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = 'unset';
        return () => { document.body.style.overflow = 'unset'; }
    }, [isOpen]);

    const alerts = useMemo(() => {
        const list = [];
        if (machines && machines.length > 0) {
            machines.forEach(m => {
                const current = parseInt(m.current_hm || 0);
                const nextDue = parseInt(m.next_pm_due_hm || 0);
                if (current >= nextDue) {
                    list.push({ type: 'critical', message: `PM Vencido: ${m.name}`, sub: `${current}h / ${nextDue}h`, id: m.id });
                } else if (current >= nextDue - WARNING_THRESHOLD) {
                    list.push({ type: 'warning', message: `PM Próximo: ${m.name}`, sub: `Faltan ${nextDue - current}h`, id: m.id });
                }
            });
        }
        if (supplies && supplies.length > 0) {
            supplies.forEach(s => {
                const stock = parseInt(s.stock || 0);
                if (stock < 10) {
                    list.push({ type: 'warning', message: `Stock Bajo: ${s.name}`, sub: `Quedan ${stock} ${s.unit}`, id: s.id });
                }
            });
        }
        return list;
    }, [machines, supplies]);

    const hasCritical = alerts.some(a => a.type === 'critical');
    const hasWarning = alerts.some(a => a.type === 'warning');
    const hasAlerts = hasCritical || hasWarning;

    return (
        <>
            <button 
                onClick={() => setIsOpen(true)} 
                className={`relative p-2.5 rounded-full transition focus:outline-none active:scale-95 ${hasAlerts ? 'bg-white/10 text-white border border-white/20' : 'hover:bg-white/10 text-gray-300 hover:text-white'}`}
            >
                <Bell className={`w-6 h-6 ${hasCritical ? 'text-red-400' : hasWarning ? 'text-yellow-400' : 'text-current'}`} />
                {hasAlerts && (
                    <span className="absolute top-2 right-2 flex h-2.5 w-2.5">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${hasCritical ? 'bg-red-400' : 'bg-yellow-400'}`}></span>
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${hasCritical ? 'bg-red-500' : 'bg-yellow-500'}`}></span>
                    </span>
                )}
            </button>
            {isOpen && (
                <div className="fixed inset-0 z-[110] flex items-end justify-center md:items-start md:justify-end">
                    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity animate-fade-in" onClick={() => setIsOpen(false)}></div>
                    <div className="relative w-full bg-white shadow-2xl z-[111] overflow-hidden flex flex-col rounded-t-3xl h-[70vh] animate-slide-up-mobile md:h-auto md:max-h-[600px] md:w-96 md:rounded-2xl md:m-4 md:animate-fade-in">
                        <div className="md:hidden flex justify-center pt-3 pb-1" onClick={() => setIsOpen(false)}>
                            <div className="w-12 h-1.5 bg-gray-300 rounded-full"></div>
                        </div>
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-gray-800 text-lg">Notificaciones</h3>
                                <span className="bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full text-xs font-extrabold">{alerts.length}</span>
                            </div>
                            <button onClick={() => setIsOpen(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-600 p-2 rounded-full transition active:scale-95">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="overflow-y-auto px-4 pt-4 space-y-3 bg-gray-50/50 flex-1" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
                            {alerts.length > 0 ? (
                                alerts.map((alert, idx) => (
                                    <div key={idx} className={`p-4 rounded-2xl border flex items-start gap-4 transition shadow-sm bg-white ${alert.type === 'critical' ? 'border-red-100' : 'border-yellow-100'}`}>
                                        <div className={`p-2.5 rounded-full shrink-0 ${alert.type === 'critical' ? 'bg-red-50 text-red-600' : 'bg-yellow-50 text-yellow-600'}`}>
                                            {alert.type === 'critical' ? <AlertOctagon className="w-6 h-6"/> : <AlertTriangle className="w-6 h-6"/>}
                                        </div>
                                        <div>
                                            <p className={`text-sm font-bold leading-snug ${alert.type === 'critical' ? 'text-red-700' : 'text-gray-800'}`}>{alert.message}</p>
                                            <p className="text-xs text-gray-500 mt-1 font-medium">{alert.sub}</p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="py-12 text-center text-gray-400 flex flex-col items-center justify-center h-full">
                                    <div className="bg-white p-6 rounded-full mb-4 shadow-sm border border-gray-100">
                                        <CheckCircle className="w-10 h-10 opacity-30 text-green-500"/>
                                    </div>
                                    <p className="font-bold text-gray-600 text-lg">Todo al día</p>
                                    <p className="text-sm text-gray-400">No hay alertas pendientes</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const Modal = ({ isOpen, title, onClose, children, maxWidth = "max-w-lg" }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-gray-900/80 flex items-center justify-center z-[60] p-4 backdrop-blur-sm print:hidden animate-fade-in safe-padding">
            <div className={`bg-white w-full h-auto max-h-[90dvh] rounded-2xl shadow-2xl ${maxWidth} flex flex-col transition-all transform overflow-hidden`}>
                <div className="flex justify-between items-center p-4 border-b bg-indigo-50 shrink-0">
                    <h3 className="text-lg md:text-xl font-bold text-indigo-900 truncate pr-4">{title}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-red-600 p-2 rounded-full hover:bg-white transition active:scale-95 shrink-0">
                        <XCircle className="w-7 h-7" />
                    </button>
                </div>
                <div className="p-4 md:p-6 overflow-y-auto overscroll-contain bg-gray-50/50">
                    {children}
                </div>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-gray-900/80 flex items-center justify-center z-[70] p-4 backdrop-blur-sm print:hidden animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all scale-100 border border-gray-100">
                <div className="p-6 text-center">
                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4 animate-bounce-in">
                        <AlertCircle className="h-8 w-8 text-red-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
                    <p className="text-sm text-gray-500 mb-6 leading-relaxed">{message}</p>
                    <div className="flex flex-col-reverse md:flex-row justify-center gap-3">
                        <button onClick={onClose} className="w-full md:w-auto bg-white border border-gray-300 text-gray-700 px-5 py-3 rounded-xl font-bold hover:bg-gray-50 transition active:scale-95">Cancelar</button>
                        <button onClick={onConfirm} className="w-full md:w-auto bg-red-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-200 transition active:scale-95 flex items-center justify-center"><Trash2 className="w-4 h-4 mr-2" /> Eliminar</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MaintenanceReportTemplate = ({ data, onClose }) => {
    const handlePrint = () => {
        const printContent = document.getElementById('printable-area');
        if (!printContent) return;
        const printWindow = window.open('', '_blank');
        if (!printWindow) { alert("Permite pop-ups"); return; }
        printWindow.document.write(`
            <html>
                <head>
                    <title>Informe de Mantenimiento - SENATI</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
                        @page { size: A4; margin: 10mm; }
                        body { 
                            font-family: 'Roboto', sans-serif; 
                            background: white; 
                            -webkit-print-color-adjust: exact !important; 
                            print-color-adjust: exact !important;
                            font-size: 11px;
                            color: #1f2937;
                        }
                        table, tr, td, th, tbody, thead, tfoot { page-break-inside: avoid !important; }
                        .avoid-break { page-break-inside: avoid !important; break-inside: avoid !important; }
                        .table-border { border: 0.5px solid #374151; }
                        .table-header { background-color: #EBF1F9 !important; color: #000; font-weight: bold; }
                    </style>
                </head>
                <body>
                    ${printContent.innerHTML}
                    <script>setTimeout(()=>{window.print()},800)</script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };
    
    const dateStr = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleDateString('es-PE') : 'N/A';
    const woNumber = data.id ? data.id.slice(0,8).toUpperCase() : '0000';
    
    return (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-90 z-[100] overflow-y-auto flex justify-center p-4 md:p-8">
            <div className="bg-white w-full max-w-[210mm] shadow-2xl relative flex flex-col rounded-lg overflow-hidden h-[90vh]">
                <div className="flex justify-between items-center p-4 bg-slate-900 text-white sticky top-0 z-20 shadow-md shrink-0">
                    <h2 className="font-bold flex items-center text-lg truncate"><FileText className="mr-2"/> Vista Previa (A4)</h2>
                    <div className="flex gap-2">
                        <button onClick={handlePrint} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center border border-blue-500 hover:bg-blue-700 text-xs md:text-sm transition active:scale-95"><Printer className="mr-2 w-4 h-4"/> Imprimir</button>
                        <button onClick={onClose} className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-600 text-xs md:text-sm transition active:scale-95"><X className="w-4 h-4 md:hidden"/><span className="hidden md:inline">Cerrar</span></button>
                    </div>
                </div>
                <div id="printable-area" className="p-8 overflow-y-auto bg-white flex-1">
                    <div className="max-w-full mx-auto">
                        <div className="flex justify-between items-start mb-6 avoid-break border-b-2 border-blue-900 pb-4">
                            <div className="w-1/4"><div className="font-black text-3xl tracking-tighter text-blue-900 italic">SENATI</div></div>
                            <div className="flex-1 text-center"><h1 className="text-2xl font-bold text-blue-900 uppercase tracking-wide">Informe de Mantenimiento</h1><h2 className="text-sm font-bold text-gray-600 uppercase mt-1">CFP - CERRO DE PASCO</h2></div>
                            <div className="w-1/4 text-right"><div className="flex flex-col items-end"><div className="text-xs font-bold text-gray-500">WO N°: <span className="text-base text-black">{woNumber}</span></div><div className="text-xs font-bold text-gray-500">Fecha: <span className="text-black">{dateStr}</span></div></div></div>
                        </div>
                        <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-[10px] mb-6 border border-gray-300 p-3 avoid-break">
                            <div className="col-span-2 flex border-b border-gray-100 pb-1"><span className="font-bold w-24 text-gray-600">Cliente:</span> <span className="font-bold text-black uppercase">SENATI</span></div>
                            <div className="col-span-2 flex border-b border-gray-100 pb-1"><span className="font-bold w-24 text-gray-600">Modelo:</span> <span className="font-bold text-black uppercase">{data.machineName || 'N/A'}</span></div>
                            <div className="col-span-2 flex border-b border-gray-100 pb-1"><span className="font-bold w-24 text-gray-600">Tipo Contrato:</span> <span className="text-black">Mantenimiento Preventivo</span></div>
                            <div className="col-span-2 flex border-b border-gray-100 pb-1"><span className="font-bold w-24 text-gray-600">Serie:</span> <span className="text-black uppercase">---</span></div>
                            <div className="col-span-2 flex border-b border-gray-100 pb-1"><span className="font-bold w-24 text-gray-600">N° Interno:</span> <span className="text-black">---</span></div>
                            <div className="col-span-2 flex border-b border-gray-100 pb-1"><span className="font-bold w-24 text-gray-600">Lugar Op.:</span> <span className="text-black">VILLA DE PASCO</span></div>
                            <div className="col-span-2 flex border-b border-gray-100 pb-1"><span className="font-bold w-24 text-gray-600">PM Realizado:</span> <span className="font-bold text-black">{data.type}</span></div>
                            <div className="col-span-2 flex border-b border-gray-100 pb-1"><span className="font-bold w-24 text-gray-600">Horómetro PM:</span> <span className="font-bold text-black">{data.hm_done_at} h</span></div>
                            <div className="col-span-4 flex pt-1"><span className="font-bold w-24 text-gray-600">Técnico:</span> <span className="text-black uppercase">{data.operator || 'Técnico de Servicio'}</span></div>
                        </div>
                        <div className="mb-6 p-2 bg-green-50 border border-green-200 avoid-break flex items-center"><span className="font-bold text-gray-700 mr-4 text-xs">Estado de Equipo:</span><span className="text-sm font-extrabold text-green-800 uppercase">OPERATIVO CON OBSERVACIONES DE SEGUIMIENTO</span></div>
                        <div className="mb-6 text-[10px] text-gray-600 text-justify avoid-break leading-relaxed"><p className="mb-2">Estimado coordinador de área, la información presentada a continuación deberá ser revisada en su totalidad para que usted pueda conocer el estado actual del equipo.</p><p>En este informe usted podrá encontrar:</p><ol className="list-decimal ml-8 mt-1 space-y-0.5"><li>Listado de tareas realizadas durante el servicio.</li><li>Estado de observaciones encontradas en el servicio.</li><li>Nuevas observaciones encontradas durante el servicio actual y recomendaciones.</li><li>Anexos.</li></ol></div>
                        <div className="mb-6 avoid-break"><h3 className="text-sm font-bold text-blue-900 mb-2 border-b border-blue-200 pb-1">1. Listado de tareas realizadas durante el servicio</h3><p className="text-[10px] mb-2 text-gray-500">En esta visita de mantenimiento se realizaron las actividades:</p>
                            <table className="w-full text-[10px] border-collapse border border-gray-400"><thead className="bg-blue-50"><tr><th className="border border-gray-400 p-1.5 text-left w-2/3">Actividad / Suministro</th><th className="border border-gray-400 p-1.5 text-center w-1/6">Cant.</th><th className="border border-gray-400 p-1.5 text-center w-1/6">Estado</th></tr></thead><tbody><tr><td className="border border-gray-400 p-1.5 font-bold bg-gray-100" colSpan="3">Reemplazo de Filtros y Fluidos</td></tr>{data.supplies_used?.map((item, idx) => (<tr key={idx}><td className="border border-gray-400 p-1.5">{item.name}</td><td className="border border-gray-400 p-1.5 text-center">{item.qty}</td><td className="border border-gray-400 p-1.5 text-center">Si</td></tr>))}<tr><td className="border border-gray-400 p-1.5 font-bold bg-gray-100" colSpan="3">Inspección y Otros</td></tr><tr><td className="border border-gray-400 p-1.5">Inspección General del Equipo</td><td className="border border-gray-400 p-1.5 text-center">1</td><td className="border border-gray-400 p-1.5 text-center">Si</td></tr></tbody></table>
                        </div>
                        <div className="mb-6 avoid-break"><h3 className="text-sm font-bold text-blue-900 mb-2 border-b border-blue-200 pb-1">2. Observaciones</h3><table className="w-full text-[10px] border-collapse border border-gray-400"><thead className="bg-blue-50"><tr><th className="border border-gray-400 p-1.5 text-left">Descripción</th></tr></thead><tbody><tr><td className="border border-gray-400 p-2 min-h-[40px]">{data.description}</td></tr></tbody></table></div>
                        {data.images && data.images.length > 0 && (
                            <div className="mb-6 avoid-break"><h3 className="text-sm font-bold text-blue-900 mb-2 border-b border-blue-200 pb-1">3. Evidencia Fotográfica (Detalles de Servicio)</h3><div className="grid grid-cols-3 gap-2">{data.images.map((img, idx) => (<div key={idx} className="border border-gray-300 flex flex-col"><div className="h-40 w-full bg-gray-100 overflow-hidden flex items-center justify-center"><img src={img} alt={`Evidencia ${idx+1}`} className="w-full h-full object-cover" /></div><div className="p-1.5 bg-white border-t border-gray-300 text-center"><span className="text-[9px] font-bold text-gray-700 uppercase">FOTO {idx + 1}</span></div></div>))}</div></div>
                        )}
                        <div className="mt-12 grid grid-cols-2 gap-16 avoid-break"><div className="text-center"><div className="border-t border-black pt-2"><p className="font-bold text-xs text-black uppercase">{data.operator || 'Técnico'}</p><p className="text-[10px] text-gray-500 uppercase">Técnico de Servicio</p></div></div><div className="text-center"><div className="border-t border-black pt-2"><p className="font-bold text-xs text-black uppercase">SUPERVISOR</p><p className="text-[10px] text-gray-500 uppercase">V°B° Cliente / SENATI</p></div></div></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const LoginScreen = ({ onLogin }) => {
    const [username, setUsername] = useState(''); 
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const handleLogin = (e) => { e.preventDefault(); const user = DUMMY_AUTH_DB.find(u => u.username === username && u.password === password); if (user) onLogin(user); else setError('Credenciales inválidas. Prueba admin/123'); };
    return (
        <div className="min-h-[100dvh] bg-slate-900 flex items-center justify-center p-4 print:hidden">
            <div className="bg-white rounded-3xl shadow-2xl flex flex-col md:flex-row overflow-hidden max-w-4xl w-full transform transition-all">
                <div className="md:w-1/2 bg-indigo-600 p-8 md:p-12 flex flex-col justify-center items-center text-white text-center relative overflow-hidden">
                    <Truck className="w-24 h-24 mb-6 opacity-90 relative z-10 drop-shadow-lg" />
                    <h1 className="text-4xl font-extrabold mb-2 relative z-10 tracking-tight">HeavyGest</h1>
                    <p className="text-indigo-100 text-lg relative z-10 font-medium">Gestión de Flota Inteligente</p>
                </div>
                <div className="md:w-1/2 p-8 md:p-12 flex flex-col justify-center">
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Bienvenido</h2>
                    <p className="text-gray-500 mb-8">Ingresa tus credenciales para continuar</p>
                    {error && <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded-lg mb-6 text-sm flex items-center"><AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0"/>{error}</div>}
                    <form onSubmit={handleLogin} className="space-y-6">
                        <div><label className="block text-gray-700 text-sm font-bold mb-2 ml-1">Usuario</label><input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full p-3 border border-gray-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition bg-gray-50 text-base" placeholder="Ej. admin" /></div>
                        <div><label className="block text-gray-700 text-sm font-bold mb-2 ml-1">Contraseña</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-3 border border-gray-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition bg-gray-50 text-base" placeholder="••••••" /></div>
                        <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition duration-200 flex justify-center items-center shadow-lg shadow-indigo-200 active:scale-95"><LogIn className="w-5 h-5 mr-2" /> Iniciar Sesión</button>
                    </form>
                </div>
            </div>
        </div>
    );
};

const DashboardOverview = ({ machines, supplies, maintenanceHistory, usageHistory }) => {
    const totalMachines = machines.length;
    const machinesInUse = machines.filter(m => m.is_in_use).length;
    const lowStockItems = supplies.filter(s => s.stock < 10);
    const criticalAlerts = machines.filter(m => m.current_hm >= m.next_pm_due_hm).length;
    const warningAlerts = machines.filter(m => m.current_hm >= m.next_pm_due_hm - WARNING_THRESHOLD && m.current_hm < m.next_pm_due_hm).length;
    const StatCard = ({ title, value, subtext, icon: Icon, color, bgColor }) => (<div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-start justify-between hover:shadow-md transition duration-300"><div><p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</p><h3 className={`text-3xl font-extrabold ${color}`}>{value}</h3>{subtext && <p className="text-xs text-gray-400 mt-2 font-medium">{subtext}</p>}</div><div className={`p-3 rounded-xl ${bgColor}`}><Icon className={`w-6 h-6 ${color}`} /></div></div>);
    return (
        <div className="space-y-6 animate-fade-in pb-24 md:pb-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"><StatCard title="Flota Total" value={totalMachines} subtext={`${machinesInUse} en operación`} icon={Truck} color="text-blue-600" bgColor="bg-blue-50" /><StatCard title="Alertas Mantenimiento" value={criticalAlerts + warningAlerts} subtext={`${criticalAlerts} Vencidos, ${warningAlerts} Próximos`} icon={AlertTriangle} color={criticalAlerts > 0 ? "text-red-600" : warningAlerts > 0 ? "text-yellow-600" : "text-green-600"} bgColor={criticalAlerts > 0 ? "bg-red-50" : warningAlerts > 0 ? "bg-yellow-50" : "bg-green-50"} /><StatCard title="Inventario Bajo" value={lowStockItems.length} subtext="Items por agotar" icon={Package} color={lowStockItems.length > 0 ? "text-orange-600" : "text-gray-600"} bgColor="bg-orange-50" /><StatCard title="Horas Operadas" value={usageHistory.reduce((acc, curr) => acc + (curr.hoursAdded || 0), 0)} subtext="Total histórico" icon={Clock} color="text-indigo-600" bgColor="bg-indigo-50" /></div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"><h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><Wrench className="w-5 h-5 mr-2 text-indigo-500"/> Mantenimientos Recientes</h3><div className="space-y-3">{maintenanceHistory.slice(0, 5).map(m => (<div key={m.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition"><div><p className="font-bold text-sm text-gray-800">{m.machineName}</p><p className="text-xs text-gray-500 mt-0.5">{m.type} • {new Date(m.timestamp?.seconds * 1000).toLocaleDateString()}</p></div><span className="text-xs font-mono bg-white border border-gray-200 px-2 py-1 rounded-md text-gray-600">{m.hm_done_at} h</span></div>))}{maintenanceHistory.length === 0 && <p className="text-gray-400 text-sm text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">No hay actividad reciente.</p>}</div></div><div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"><h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><Package className="w-5 h-5 mr-2 text-orange-500"/> Alertas de Stock</h3><div className="space-y-3">{lowStockItems.length > 0 ? lowStockItems.map(s => (<div key={s.id} className="flex justify-between items-center p-3 bg-orange-50 rounded-xl border border-orange-100"><div className="flex items-center"><div className="w-2 h-2 bg-red-500 rounded-full mr-3 animate-pulse"></div><div><p className="font-bold text-sm text-gray-800">{s.name}</p><p className="text-xs text-red-600 font-semibold mt-0.5">Quedan: {s.stock} {s.unit}</p></div></div><button className="text-orange-600 bg-white p-1.5 rounded-lg shadow-sm border border-orange-100"><ChevronRight className="w-4 h-4"/></button></div>)) : <div className="flex flex-col items-center justify-center h-40 text-green-600 bg-green-50 rounded-xl border border-dashed border-green-200"><CheckCircle className="w-8 h-8 mb-2 opacity-50"/><p className="text-sm font-medium">Inventario Saludable</p></div>}</div></div></div>
        </div>
    );
};

const MachineManagementSection = ({ userId, machines, showMessage, userRole }) => {
    const [modalOpen, setModalOpen] = useState(false);
    const [refuelModalOpen, setRefuelModalOpen] = useState(false);
    const [editingMachine, setEditingMachine] = useState(null);
    const [selectedMachineForRefuel, setSelectedMachineForRefuel] = useState(null);
    const [refuelLevel, setRefuelLevel] = useState(0);
    const [formData, setFormData] = useState({ name: '', model: '', plate: '', current_hm: '', next_pm_sequence_index: 0, fuel_level: 100, image_type: 'preset', image_src: 'excavator' });
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const canEdit = userRole === 'Administrador';
    const canCreate = userRole === 'Administrador' || userRole === 'Instructor'; 
    const canRefuel = userRole === 'Administrador' || userRole === 'Instructor';

    const openModal = (machine = null) => { setEditingMachine(machine); if (machine) { const seqIdx = machine.next_pm_sequence_index !== undefined ? machine.next_pm_sequence_index : getRecommendedSequenceIndex(machine.current_hm); setFormData({ name: machine.name, model: machine.model, plate: machine.plate || '', current_hm: machine.current_hm, next_pm_sequence_index: seqIdx, fuel_level: machine.fuel_level || 100, image_type: machine.image_type || 'preset', image_src: machine.image_src || 'excavator' }); } else { setFormData({ name: '', model: '', plate: '', current_hm: '', next_pm_sequence_index: 0, fuel_level: 100, image_type: 'preset', image_src: 'excavator' }); } setModalOpen(true); };
    const openRefuelModal = (machine) => { setSelectedMachineForRefuel(machine); setRefuelLevel(machine.fuel_level || 0); setRefuelModalOpen(true); };
    
    const handleRefuel = async (e) => { 
        e.preventDefault(); 
        if (!selectedMachineForRefuel) return; 
        
        const newLevel = parseInt(refuelLevel); 
        
        if (newLevel <= selectedMachineForRefuel.fuel_level) { 
            return showMessage('El porcentaje de combustible debe ser mayor al actual para repostar.', 'error'); 
        } 
        
        try { 
            const ref = getCollectionRef('machines', userId); 
            await updateDoc(doc(ref, selectedMachineForRefuel.id), { fuel_level: newLevel }); 
            showMessage('Repostaje registrado con éxito', 'success'); 
            setRefuelModalOpen(false); 
        } catch(e) { 
            showMessage('Error al registrar repostaje', 'error'); 
        } 
    };

    const handleHmChange = (val) => { 
        const hm = parseInt(val) || 0; 
        if (!editingMachine) { 
            const recommendedIndex = getRecommendedSequenceIndex(hm); 
            setFormData(prev => ({ ...prev, current_hm: val, next_pm_sequence_index: recommendedIndex })); 
        } else { 
            setFormData(prev => ({ ...prev, current_hm: val })); 
        } 
    };
    const handleFileUpload = (e) => { const file = e.target.files[0]; if (file) { if (file.size > 500000) { showMessage('La imagen es muy grande. Máx 500KB.', 'error'); return; } const reader = new FileReader(); reader.onloadend = () => { setFormData(prev => ({ ...prev, image_type: 'url', image_src: reader.result })); }; reader.readAsDataURL(file); } };
    const handleSave = async (e) => { e.preventDefault(); const ref = getCollectionRef('machines', userId); const hmInt = parseInt(formData.current_hm); const cycleIdx = parseInt(formData.next_pm_sequence_index); const fuelInt = parseInt(formData.fuel_level); if (isNaN(hmInt) || hmInt < 0) return showMessage('Horómetro inválido', 'error'); try { const nextPmType = PM_SEQUENCE[cycleIdx]; const nextPmDueHm = hmInt + 250; const machineData = { name: formData.name, model: formData.model, plate: formData.plate, current_hm: hmInt, fuel_level: fuelInt, next_pm_sequence_index: cycleIdx, next_pm_type: nextPmType, next_pm_due_hm: nextPmDueHm, image_type: formData.image_type, image_src: formData.image_src }; if (editingMachine) { await updateDoc(doc(ref, editingMachine.id), machineData); showMessage('Equipo actualizado', 'success'); } else { await addDoc(ref, { ...machineData, is_in_use: false, series: 'S/N ' + Date.now().toString().slice(-6), last_pm_type: 'Nuevo', last_pm_hm: 0 }); showMessage('Equipo registrado', 'success'); } setModalOpen(false); } catch (error) { showMessage('Error al guardar', 'error'); } };
    const confirmDelete = async () => { if (!confirmDeleteId) return; try { await deleteDoc(doc(getCollectionRef('machines', userId), confirmDeleteId)); showMessage('Equipo eliminado correctamente', 'success'); } catch (error) { showMessage('Error al eliminar el equipo', 'error'); } finally { setConfirmDeleteId(null); } };

    return (
        <div className="space-y-6 pb-24 md:pb-0">
            <ConfirmationModal isOpen={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} onConfirm={confirmDelete} title="Eliminar Equipo" message="¿Estás seguro de que quieres eliminar este equipo? Esta acción no se puede deshacer." />
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100 z-10 md:static">
                <h3 className="text-lg font-bold text-gray-800">Inventario de Equipos</h3>
                {canCreate && (
                    <button onClick={() => openModal()} className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl flex items-center text-sm font-bold hover:bg-indigo-700 transition active:scale-95 shadow-lg shadow-indigo-200">
                        <Plus className="w-5 h-5 mr-2" /> Nuevo
                    </button>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{machines.map(m => { const isDue = m.current_hm >= m.next_pm_due_hm; const isClose = m.current_hm >= m.next_pm_due_hm - WARNING_THRESHOLD && m.current_hm < m.next_pm_due_hm; const ImgComp = m.image_type === 'preset' ? (MACHINE_ICONS.find(i => i.id === m.image_src)?.icon || Truck) : Truck; return (<div key={m.id} className={`bg-white p-5 rounded-2xl shadow-sm border-t-4 ${isDue ? 'border-red-500' : isClose ? 'border-yellow-500' : 'border-green-500'} hover:shadow-md transition relative overflow-hidden`}><div className="flex gap-4 mb-4"><div className="w-16 h-16 flex-shrink-0 bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200 overflow-hidden">{m.image_type === 'url' ? (<img src={m.image_src} alt={m.name} className="w-full h-full object-cover" onError={(e) => e.target.src='https://placehold.co/64?text=EQ'} />) : (<ImgComp className="w-8 h-8 text-indigo-500" />)}</div><div className="flex-1"><div className="flex justify-between items-start"><h4 className="font-bold text-gray-800 text-lg leading-tight line-clamp-1">{m.name}</h4>{m.is_in_use ? <span className="bg-orange-100 text-orange-700 text-[10px] font-bold px-2 py-1 rounded-lg animate-pulse border border-orange-200 whitespace-nowrap">EN USO</span> : <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-1 rounded-lg border border-green-200 whitespace-nowrap">DISP.</span>}</div><p className="text-xs text-gray-500 mt-1">{m.model} • <span className="font-mono bg-gray-100 px-1 rounded text-indigo-900 font-bold">{m.plate || 'S/P'}</span></p></div></div><div className="bg-gray-50 p-3 rounded-xl mb-3 flex justify-between items-center border border-gray-100"><span className="text-xs font-bold text-gray-500 uppercase">Horómetro</span><span className="font-mono text-lg font-bold text-indigo-600 tracking-tight">{m.current_hm} h</span></div><div className="mb-4 px-1 flex items-end gap-2"><div className="flex-1"><FuelGauge percentage={m.fuel_level || 0} /></div>{canRefuel && <button onClick={() => openRefuelModal(m)} className="bg-green-50 text-green-700 p-1.5 rounded-lg hover:bg-green-100 active:scale-95 transition border border-green-200" title="Repostar"><Droplets className="w-4 h-4"/></button>}</div><div className="text-xs text-gray-500 mb-4 flex items-center"><span className={`w-2 h-2 rounded-full mr-2 ${isDue ? 'bg-red-500' : isClose ? 'bg-yellow-500' : 'bg-green-500'}`}></span>Próximo: <strong className="ml-1">{m.next_pm_type}</strong> <span className="mx-1">|</span> {m.next_pm_due_hm} h</div>{canEdit && <div className="flex gap-2 justify-end pt-3 border-t border-gray-100 relative z-10"><button onClick={() => openModal(m)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center text-xs font-bold transition active:scale-95"><Edit2 className="w-4 h-4 mr-1" /> Editar</button><button onClick={() => setConfirmDeleteId(m.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg flex items-center text-xs font-bold transition active:scale-95"><Trash2 className="w-4 h-4 mr-1" /> Eliminar</button></div>}</div>)})}</div>
            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingMachine ? "Editar Equipo" : "Nuevo Equipo"}><form onSubmit={handleSave} className="space-y-5"><div className="bg-gray-50 p-3 rounded-xl border border-gray-200"><label className="block text-sm font-bold mb-2 text-gray-700">Imagen / Logotipo</label><div className="flex gap-2 mb-3"><button type="button" onClick={() => setFormData({...formData, image_type: 'preset'})} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition ${formData.image_type === 'preset' ? 'bg-white border-indigo-500 text-indigo-700 shadow-sm' : 'border-transparent text-gray-500 hover:bg-gray-100'}`}>Icono</button><button type="button" onClick={() => setFormData({...formData, image_type: 'url'})} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition ${formData.image_type === 'url' ? 'bg-white border-indigo-500 text-indigo-700 shadow-sm' : 'border-transparent text-gray-500 hover:bg-gray-100'}`}>Foto / URL</button></div>{formData.image_type === 'preset' ? (<div className="grid grid-cols-4 gap-2">{MACHINE_ICONS.map(icon => (<button type="button" key={icon.id} onClick={() => setFormData({...formData, image_src: icon.id})} className={`p-2 rounded-xl border flex flex-col items-center justify-center transition ${formData.image_src === icon.id ? 'border-indigo-500 bg-white shadow-sm' : 'border-transparent hover:bg-gray-200'}`}><icon.icon className={`w-6 h-6 mb-1 ${formData.image_src === icon.id ? 'text-indigo-600' : 'text-gray-400'}`}/><span className="text-[10px] font-medium text-gray-600">{icon.label}</span></button>))}</div>) : (<div className="space-y-3"><div className="relative"><ImageIcon className="absolute left-3 top-3 w-5 h-5 text-gray-400"/><input type="text" value={formData.image_src.startsWith('data:') ? '(Imagen subida)' : formData.image_src} onChange={e => setFormData({...formData, image_src: e.target.value})} className="w-full pl-10 p-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" placeholder="https://ejemplo.com/foto.jpg" disabled={formData.image_src.startsWith('data:')} /></div><div className="flex items-center justify-center w-full"><label className="flex flex-col items-center justify-center w-full h-24 border-2 border-gray-300 border-dashed rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100"><div className="flex flex-col items-center justify-center pt-5 pb-6"><Upload className="w-6 h-6 text-gray-400 mb-1" /><p className="text-xs text-gray-500"><span className="font-semibold">Click para subir</span></p><p className="text-[10px] text-gray-400">JPG, PNG (Max 500KB)</p></div><input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} /></label></div></div>)}</div><div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-bold mb-1.5 text-gray-700">Nombre</label><input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-gray-50 focus:bg-white transition" placeholder="Ej: Excavadora..." /></div><div><label className="block text-sm font-bold mb-1.5 text-gray-700">Placa / ID</label><input required type="text" value={formData.plate} onChange={e => setFormData({...formData, plate: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-gray-50 focus:bg-white transition" placeholder="Ej: CAT-001" /></div></div><div><label className="block text-sm font-bold mb-1.5 text-gray-700">Modelo</label><input required type="text" value={formData.model} onChange={e => setFormData({...formData, model: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-gray-50 focus:bg-white transition" /></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="block text-sm font-bold mb-1.5 text-gray-700">Horómetro</label><input required type="number" min="0" value={formData.current_hm} onChange={e => handleHmChange(e.target.value)} className="w-full border border-gray-200 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-base font-mono bg-gray-50 focus:bg-white transition" /></div><div><label className="block text-sm font-bold mb-1.5 text-indigo-600">Próximo PM</label><select value={formData.next_pm_sequence_index} onChange={e => setFormData({...formData, next_pm_sequence_index: parseInt(e.target.value)})} className="w-full border border-indigo-100 p-3 rounded-xl bg-indigo-50/50 font-semibold text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-none text-base">{PM_CYCLE_LABELS.map((label, idx) => (<option key={idx} value={idx}>{label}</option>))}</select></div></div><div className="bg-gray-50 p-4 rounded-xl border border-gray-100"><div className="flex justify-between mb-2"><label className="text-sm font-bold text-gray-700">Nivel de Combustible Inicial</label><span className="font-bold text-indigo-600">{formData.fuel_level}%</span></div><input type="range" min="0" max="100" value={formData.fuel_level} onChange={e => setFormData({...formData, fuel_level: e.target.value})} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"/><div className="flex justify-between text-xs text-gray-400 mt-1"><span>0%</span><span>50%</span><span>100%</span></div></div><div className="pt-4 flex justify-end"><button type="submit" className="w-full md:w-auto bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition active:scale-95">Guardar</button></div></form></Modal>
            
            <Modal isOpen={refuelModalOpen} onClose={() => setRefuelModalOpen(false)} title="Repostar Combustible">
                <form onSubmit={handleRefuel} className="space-y-5">
                    <div className="text-center mb-4">
                        <p className="text-sm text-gray-500">Equipo</p>
                        <h3 className="text-xl font-bold text-gray-800">{selectedMachineForRefuel?.name}</h3>
                        <p className="text-sm font-bold text-indigo-600 mt-1">Nivel Actual: {selectedMachineForRefuel?.fuel_level}%</p>
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-1.5 text-gray-700 text-center">Nuevo Nivel de Combustible</label>
                        <div className="flex items-center justify-center gap-4 mb-2">
                            <span className="text-3xl font-bold text-indigo-600">{refuelLevel}%</span>
                        </div>
                        <input type="range" min="0" max="100" value={refuelLevel} onChange={e => setRefuelLevel(e.target.value)} className="w-full h-4 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"/>
                        <div className="flex justify-between text-xs text-gray-400 mt-1 px-1"><span>0%</span><span>100%</span></div>
                    </div>
                    <div className="pt-4 flex justify-end">
                        <button type="submit" className="w-full bg-green-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-green-700 transition active:scale-95 flex items-center justify-center">
                            <Droplets className="w-5 h-5 mr-2"/> Confirmar Repostaje
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

const UserManagementSection = ({ userId, users, showMessage, userRole }) => {
    const [modalOpen, setModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [formData, setFormData] = useState({ username: '', password: '', role: 'Instructor' });
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const canEdit = userRole === 'Administrador';

    const handleSave = async (e) => { e.preventDefault(); const ref = getCollectionRef('users_list', userId); try { if (editingUser) { await updateDoc(doc(ref, editingUser.id), formData); showMessage('Usuario actualizado', 'success'); } else { await addDoc(ref, { ...formData, createdAt: serverTimestamp() }); showMessage('Usuario creado', 'success'); } setModalOpen(false); } catch (error) { showMessage('Error al guardar', 'error'); } };
    const confirmDelete = async () => { if (!confirmDeleteId) return; try { await deleteDoc(doc(getCollectionRef('users_list', userId), confirmDeleteId)); showMessage('Usuario eliminado', 'success'); } catch (error) { showMessage('Error al eliminar', 'error'); } finally { setConfirmDeleteId(null); } };
    const openModal = (user = null) => { setEditingUser(user); setFormData(user ? { username: user.username, password: user.password, role: user.role } : { username: '', password: '', role: 'Instructor' }); setModalOpen(true); };

    return (
        <div className="space-y-6 pb-24 md:pb-0">
            <ConfirmationModal isOpen={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} onConfirm={confirmDelete} title="Eliminar Usuario" message="¿Seguro que deseas eliminar este usuario?" />
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100 z-10 md:static">
                <h3 className="text-lg font-bold text-gray-800">Usuarios</h3>
                {canEdit && (
                    <button onClick={() => openModal()} className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl flex items-center text-sm font-bold hover:bg-indigo-700 transition active:scale-95 shadow-lg shadow-indigo-200">
                        <UserPlus className="w-5 h-5 mr-2" /> Nuevo
                    </button>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{users.map(u => (<div key={u.id} className="bg-white p-5 rounded-2xl shadow-sm border-l-4 border-indigo-500 flex justify-between items-center"><div className="flex items-center gap-4"><div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-white shadow-md ${u.role === 'Administrador' ? 'bg-purple-600' : 'bg-blue-500'}`}>{u.username[0].toUpperCase()}</div><div><h4 className="font-bold text-gray-800">{u.username}</h4><span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md border border-gray-200">{u.role}</span></div></div>{canEdit && <div className="flex gap-1"><button onClick={() => openModal(u)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition active:scale-95"><Edit2 className="w-5 h-5"/></button><button onClick={() => setConfirmDeleteId(u.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition active:scale-95"><Trash2 className="w-5 h-5"/></button></div>}</div>))}</div>
            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingUser ? "Editar Usuario" : "Nuevo Usuario"}><form onSubmit={handleSave} className="space-y-5"><div><label className="block text-sm font-bold mb-1.5 text-gray-700">Usuario</label><input required type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white transition" /></div><div><label className="block text-sm font-bold mb-1.5 text-gray-700">Contraseña</label><input required type="text" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white transition" /></div><div><label className="block text-sm font-bold mb-1.5 text-gray-700">Rol</label><select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl text-base bg-white focus:ring-2 focus:ring-indigo-500 outline-none"><option value="Instructor">Instructor</option><option value="Administrador">Administrador</option><option value="Estudiante">Estudiante</option></select></div><div className="pt-4 flex justify-end"><button type="submit" className="w-full md:w-auto bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition active:scale-95">Guardar</button></div></form></Modal>
        </div>
    );
};

const InventorySection = ({ userId, supplies, showMessage, userRole }) => {
    const [search, setSearch] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [restockModalOpen, setRestockModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [selectedItemForRestock, setSelectedItemForRestock] = useState(null);
    const [restockQty, setRestockQty] = useState(0);
    const [form, setForm] = useState({ name: '', stock: 0, unit: 'Unidades' });
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    // Permission Logic
    const canCreate = userRole === 'Administrador' || userRole === 'Instructor';
    const canRestock = userRole === 'Administrador' || userRole === 'Instructor';
    const canEditDelete = userRole === 'Administrador';

    const filteredSupplies = supplies.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

    const handleSaveStock = async (e) => {
        e.preventDefault();
        try {
            const ref = getCollectionRef('supplies', userId);
            if (editingItem) await updateDoc(doc(ref, editingItem.id), form); else await addDoc(ref, form);
            setModalOpen(false); showMessage('Inventario actualizado', 'success');
        } catch (err) { showMessage('Error al guardar', 'error'); }
    };

    const handleRestock = async (e) => {
        e.preventDefault();
        if(!selectedItemForRestock) return;
        const qtyToAdd = parseInt(restockQty);
        if(qtyToAdd <= 0) return showMessage("Cantidad inválida", "error");

        try {
            const ref = doc(getCollectionRef('supplies', userId), selectedItemForRestock.id);
            const newStock = parseInt(selectedItemForRestock.stock || 0) + qtyToAdd;
            await updateDoc(ref, { stock: newStock });
            setRestockModalOpen(false);
            showMessage(`Stock actualizado: +${qtyToAdd} ${selectedItemForRestock.unit}`, 'success');
        } catch(e) { showMessage('Error al actualizar stock', 'error'); }
    };

    const confirmDeleteStock = async () => {
        if (!confirmDeleteId) return;
        try { await deleteDoc(doc(getCollectionRef('supplies', userId), confirmDeleteId)); showMessage('Eliminado correctamente', 'success'); } 
        catch (error) { showMessage('Error al eliminar', 'error'); } finally { setConfirmDeleteId(null); }
    };

    return (
        <div className="space-y-6 pb-24 md:pb-0">
            <ConfirmationModal isOpen={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} onConfirm={confirmDeleteStock} title="Eliminar Suministro" message="¿Seguro que deseas eliminar este item?" />
            
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 animate-fade-in">
                <div className="relative w-full md:w-96"><Search className="absolute left-4 top-3.5 text-gray-400 w-5 h-5" /><input type="text" placeholder="Buscar suministro..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white text-base transition"/></div>
                {canCreate && (
                    <button onClick={() => { setEditingItem(null); setForm({name:'', stock:0, unit:'Unidades'}); setModalOpen(true); }} className="bg-green-600 text-white px-6 py-3 rounded-xl flex items-center hover:bg-green-700 transition w-full md:w-auto justify-center font-bold text-sm shadow-lg shadow-green-200 active:scale-95">
                        <Plus className="w-5 h-5 mr-2" /> Nuevo Item
                    </button>
                )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                {filteredSupplies.map(s => (
                    <div key={s.id} className="bg-white p-5 rounded-2xl shadow-sm border-l-4 border-indigo-500 flex justify-between items-center hover:shadow-md transition">
                        <div><h4 className="font-bold text-gray-800 text-sm mb-1">{s.name}</h4><p className={`text-xs font-bold px-2 py-1 rounded-md inline-block ${s.stock < 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>Stock: {s.stock} {s.unit}</p></div>
                        <div className="flex gap-1">
                            {canRestock && (
                                <button onClick={() => { setSelectedItemForRestock(s); setRestockQty(0); setRestockModalOpen(true); }} className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition active:scale-95" title="Re-Stock">
                                    <PlusCircle className="w-5 h-5" />
                                </button>
                            )}
                            {canEditDelete && (
                                <>
                                    <button onClick={() => { setEditingItem(s); setForm(s); setModalOpen(true); }} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-gray-50 rounded-lg transition active:scale-95"><Edit2 className="w-5 h-5" /></button>
                                    <button onClick={() => setConfirmDeleteId(s.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-gray-50 rounded-lg transition active:scale-95"><Trash2 className="w-5 h-5" /></button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingItem ? "Editar Suministro" : "Nuevo Suministro"}>
                <form onSubmit={handleSaveStock} className="space-y-5">
                    <div><label className="block text-sm font-bold mb-1.5 text-gray-700">Nombre</label><input required type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white transition" /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-sm font-bold mb-1.5 text-gray-700">Stock Inicial</label><input required type="number" value={form.stock} onChange={e => setForm({...form, stock: Number(e.target.value)})} className="w-full border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white transition" /></div>
                        <div><label className="block text-sm font-bold mb-1.5 text-gray-700">Unidad</label><input required type="text" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white transition" /></div>
                    </div>
                    <div className="pt-4 flex justify-end"><button type="submit" className="w-full md:w-auto bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition active:scale-95">Guardar</button></div>
                </form>
            </Modal>

            <Modal isOpen={restockModalOpen} onClose={() => setRestockModalOpen(false)} title="Reabastecer Stock">
                <form onSubmit={handleRestock} className="space-y-5">
                    <div className="text-center mb-4">
                        <p className="text-sm text-gray-500">Item</p>
                        <h3 className="text-xl font-bold text-gray-800">{selectedItemForRestock?.name}</h3>
                        <p className="text-sm font-bold text-green-600 mt-1">Actual: {selectedItemForRestock?.stock} {selectedItemForRestock?.unit}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-1.5 text-gray-700 text-center">Cantidad a Agregar</label>
                        <input required type="number" min="1" value={restockQty} onChange={e => setRestockQty(e.target.value)} className="w-full border border-gray-200 p-4 rounded-xl text-3xl text-center font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white transition" />
                    </div>
                    <div className="pt-2 flex justify-end">
                        <button type="submit" className="w-full bg-green-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-green-700 transition active:scale-95 flex items-center justify-center">
                            <PlusCircle className="w-5 h-5 mr-2"/> Confirmar Ingreso
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

const MaintenanceSection = ({ userId, machines, supplies, history, pmConfigs, showMessage, userRole }) => {
    const [viewMode, setViewMode] = useState('register'); // register | history | kits
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedMachine, setSelectedMachine] = useState(null);
    const [type, setType] = useState('Programado');
    const [formData, setFormData] = useState({ hm: '', fuel_level: 100, desc: '', usedSupplies: [], images: [] }); 
    const [tempSupplyId, setTempSupplyId] = useState('');
    const [tempQty, setTempQty] = useState(1);
    const [historyFilter, setHistoryFilter] = useState('Programado');
    const [reportData, setReportData] = useState(null);

    // Estado para Kits
    const [selectedPmType, setSelectedPmType] = useState('PM1');
    const [kitForm, setKitForm] = useState({ supplyId: '', qty: 1, isMandatory: true });
    const currentPmConfig = pmConfigs[selectedPmType] || [];

    // Permissions
    const canRegister = userRole === 'Administrador' || userRole === 'Instructor';
    const canManageKits = userRole === 'Administrador';

    // Funciones Kits
    const handleAddKitItem = async (e) => {
        e.preventDefault();
        if (!kitForm.supplyId) return showMessage('Selecciona un suministro', 'error');
        const supply = supplies.find(s => s.id === kitForm.supplyId);
        if (!supply) return;
        const newItem = { supplyId: supply.id, name: supply.name, qty: parseInt(kitForm.qty), isMandatory: kitForm.isMandatory };
        try {
            const configRef = doc(getCollectionRef('pm_configs', userId), selectedPmType);
            const updatedItems = [...currentPmConfig, newItem];
            await setDoc(configRef, { items: updatedItems }); 
            showMessage(`Item agregado al kit ${selectedPmType}`, 'success');
            setKitForm({ supplyId: '', qty: 1, isMandatory: true });
        } catch(error) { showMessage('Error al actualizar kit', 'error'); }
    };

    const removeKitItem = async (indexToRemove) => {
        try {
            const configRef = doc(getCollectionRef('pm_configs', userId), selectedPmType);
            const updatedItems = currentPmConfig.filter((_, index) => index !== indexToRemove);
            await setDoc(configRef, { items: updatedItems });
            showMessage('Item removido del kit', 'success');
        } catch(error) { showMessage('Error al remover item', 'error'); }
    };

    const openModal = (machine, mType) => {
        setSelectedMachine(machine); setType(mType);
        let initialSupplies = [];
        let description = '';
        if (mType === 'Programado') {
            const pmType = machine.next_pm_type;
            description = pmType;
            const kitItems = pmConfigs[pmType] || [];
            initialSupplies = kitItems.map(kItem => {
                const supplyData = supplies.find(s => s.id === kItem.supplyId);
                return {
                    id: kItem.supplyId,
                    name: kItem.name,
                    qty: kItem.qty,
                    isMandatory: kItem.isMandatory,
                    stock: supplyData ? supplyData.stock : 0 
                };
            });
        }
        setFormData({ hm: machine.current_hm, fuel_level: machine.fuel_level || 100, desc: description, usedSupplies: initialSupplies, images: [] });
        setModalOpen(true);
    };

    const addSupplyToUsage = () => {
        if (!tempSupplyId) return;
        const supply = supplies.find(s => s.id === tempSupplyId);
        if (!supply) return;
        const exists = formData.usedSupplies.find(s => s.id === tempSupplyId);
        if(exists) return showMessage('Item ya en lista', 'error');
        if(tempQty > supply.stock) return showMessage(`Stock insuficiente (${supply.stock})`, 'error');
        setFormData(prev => ({ ...prev, usedSupplies: [...prev.usedSupplies, { id: supply.id, name: supply.name, qty: tempQty, isMandatory: false }] }));
        setTempSupplyId(''); setTempQty(1);
    };

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length + formData.images.length > 3) {
            return showMessage('Máximo 3 imágenes permitidas', 'error');
        }

        const newImages = [];
        for (const file of files) {
            if (file.size > 2 * 1024 * 1024) { // Limite inicial de lectura 2MB
                 showMessage(`Imagen ${file.name} muy pesada, se intentará comprimir`, 'warning');
            }
            try {
                const compressedDataUrl = await compressImage(file);
                newImages.push(compressedDataUrl);
            } catch (err) {
                console.error("Error comprimiendo imagen", err);
                showMessage(`Error al procesar ${file.name}`, 'error');
            }
        }
        setFormData(prev => ({ ...prev, images: [...prev.images, ...newImages] }));
    };

    const handleRemoveImage = (index) => {
        setFormData(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const hmDone = parseInt(formData.hm);
        const fuelInt = parseInt(formData.fuel_level);

        if (hmDone < selectedMachine.current_hm) return showMessage('Horómetro incorrecto', 'error');
        
        if (type === 'Programado') {
             const pmType = selectedMachine.next_pm_type;
             const kitItems = pmConfigs[pmType] || [];
             for (const kItem of kitItems) {
                 if (kItem.isMandatory) {
                     const inList = formData.usedSupplies.find(u => u.id === kItem.supplyId);
                     if (!inList) return showMessage(`Falta suministro obligatorio: ${kItem.name}`, 'error');
                 }
             }
        }

        for (const item of formData.usedSupplies) {
             const currentSupply = supplies.find(s => s.id === item.id);
             if (!currentSupply) return showMessage(`Item ${item.name} no encontrado en inventario`, 'error');
             if (currentSupply.stock < item.qty) return showMessage(`Stock insuficiente para ${item.name}. Stock: ${currentSupply.stock}`, 'error');
        }
        
        try {
            const batch = writeBatch(db);
            const machineRef = doc(getCollectionRef('machines', userId), selectedMachine.id);
            let updateData = { current_hm: hmDone, last_pm_hm: hmDone, fuel_level: fuelInt };
            
            if (type === 'Programado') {
                const currentSeqIdx = selectedMachine.next_pm_sequence_index || 0;
                const nextStep = calculateNextPmStep(hmDone, currentSeqIdx);
                updateData = { 
                    ...updateData, 
                    next_pm_type: nextStep.nextPmType, 
                    next_pm_due_hm: nextStep.nextPmDueHm, 
                    next_pm_sequence_index: nextStep.nextSequenceIndex, 
                    last_pm_type: selectedMachine.next_pm_type 
                };
            }
            
            batch.update(machineRef, updateData);
            const historyRef = doc(getCollectionRef('maintenance_history', userId));
            batch.set(historyRef, { 
                machineId: selectedMachine.id, 
                machineName: selectedMachine.name, 
                type, 
                description: formData.desc, 
                hm_done_at: hmDone, 
                fuel_level: fuelInt, 
                supplies_used: formData.usedSupplies,
                images: formData.images, // Guardamos las imágenes
                timestamp: serverTimestamp() 
            });
            formData.usedSupplies.forEach(item => {
                const supplyRef = doc(getCollectionRef('supplies', userId), item.id);
                const currentSupply = supplies.find(s => s.id === item.id);
                if(currentSupply) { 
                    const newStock = Math.max(0, currentSupply.stock - item.qty); 
                    batch.update(supplyRef, { stock: newStock }); 
                }
            });
            await batch.commit(); 
            showMessage('Mantenimiento registrado', 'success'); setModalOpen(false);
        } catch (error) { 
            console.error(error);
            if (error.code === 'invalid-argument') {
                showMessage('Error: Las imágenes son demasiado pesadas para guardar.', 'error');
            } else {
                showMessage('Error al registrar', 'error'); 
            }
        }
    };

    const filteredHistory = history.filter(h => {
        if (historyFilter === 'Programado') return h.type === 'Programado';
        if (historyFilter === 'Correctivo') return h.type === 'No Programado';
        return true;
    });

    return (
        <div className="space-y-6 pb-24 md:pb-0">
            {reportData && (<MaintenanceReportTemplate data={reportData} onClose={() => setReportData(null)} />)}
            
            <div className="flex space-x-2 bg-gray-100 p-1 rounded-xl w-fit mx-auto md:mx-0 mb-6">
                <button onClick={() => setViewMode('register')} className={`px-5 py-2 rounded-lg text-sm font-bold transition flex items-center ${viewMode === 'register' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><Wrench className="w-4 h-4 mr-2"/> Ejecución</button>
                <button onClick={() => setViewMode('history')} className={`px-5 py-2 rounded-lg text-sm font-bold transition flex items-center ${viewMode === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><History className="w-4 h-4 mr-2"/> Historial</button>
                <button onClick={() => setViewMode('kits')} className={`px-5 py-2 rounded-lg text-sm font-bold transition flex items-center ${viewMode === 'kits' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><Settings className="w-4 h-4 mr-2"/> Config. Kits</button>
            </div>

            {viewMode === 'register' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                    {machines.map(m => {
                        const isDue = m.current_hm >= m.next_pm_due_hm;
                        const isClose = m.current_hm >= m.next_pm_due_hm - WARNING_THRESHOLD && m.current_hm < m.next_pm_due_hm;
                        return (
                            <div key={m.id} className={`bg-white p-5 rounded-2xl shadow-sm border-t-4 ${isDue ? 'border-red-500' : isClose ? 'border-yellow-500' : 'border-green-500'} hover:shadow-md transition`}>
                                <div className="flex justify-between mb-3"><h4 className="font-bold text-gray-800 text-lg">{m.name}</h4>{isDue ? <AlertTriangle className="text-red-500 w-6 h-6 animate-pulse" /> : isClose ? <AlertTriangle className="text-yellow-500 w-6 h-6" /> : <CheckCircle className="text-green-500 w-6 h-6" />}</div>
                                <div className="bg-gray-50 p-3 rounded-xl mb-4 flex justify-between items-center"><span className="text-xs font-bold text-gray-500 uppercase">Horómetro</span><span className="font-mono text-lg font-bold text-indigo-600">{m.current_hm} h</span></div>
                                <div className="text-xs text-gray-500 mb-4 flex items-center"><span className={`w-2 h-2 rounded-full mr-2 ${isDue ? 'bg-red-500' : 'bg-green-500'}`}></span>Próximo: <strong className="ml-1">{m.next_pm_type}</strong> <span className="mx-1">|</span> {m.next_pm_due_hm} h</div>
                                <div className="flex gap-2">
                                    {canRegister ? (
                                        <>
                                            <button onClick={() => openModal(m, 'Programado')} className="flex-1 bg-indigo-50 text-indigo-700 py-2.5 rounded-xl text-xs font-bold hover:bg-indigo-100 transition active:scale-95">PM Programado</button>
                                            <button onClick={() => openModal(m, 'No Programado')} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-xs font-bold hover:bg-gray-200 transition active:scale-95">Correctivo</button>
                                        </>
                                    ) : (
                                        <div className="flex-1 text-center py-2.5 text-xs text-gray-400 italic bg-gray-50 rounded-xl border border-dashed border-gray-200">Solo lectura</div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {viewMode === 'history' && (
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100 animate-fade-in">
                    <div className="p-4 border-b flex flex-col md:flex-row justify-between items-center bg-gray-50 gap-4">
                        <div className="flex space-x-2 w-full md:w-auto bg-gray-200 p-1.5 rounded-xl">
                            <button onClick={() => setHistoryFilter('Programado')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all ${historyFilter === 'Programado' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><ClipboardList className="w-4 h-4 inline mr-1 mb-0.5" /> PM Programado</button>
                            <button onClick={() => setHistoryFilter('Correctivo')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all ${historyFilter === 'Correctivo' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><AlertOctagon className="w-4 h-4 inline mr-1 mb-0.5" /> Correctivo</button>
                        </div>
                    </div>
                    
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-600">
                            <thead className="bg-gray-50 text-xs uppercase text-gray-700 font-bold">
                                <tr>
                                    <th className="px-6 py-3">Fecha</th>
                                    <th className="px-6 py-3">Equipo</th>
                                    <th className="px-6 py-3">Operador</th>
                                    <th className="px-6 py-3 text-center">Tiempo Real</th>
                                    <th className="px-6 py-3 text-center">HM (+Horas)</th>
                                    <th className="px-6 py-3 text-center">Combustible</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredHistory.map(h => (
                                    <tr key={h.id} className="border-b hover:bg-gray-50">
                                        <td className="px-6 py-3 whitespace-nowrap">{h.timestamp ? new Date(h.timestamp.seconds * 1000).toLocaleDateString() : '-'}</td>
                                        <td className="px-6 py-3 font-medium text-gray-900">{h.machineName}</td>
                                        <td className="px-6 py-3">{h.operator || 'Desconocido'}</td>
                                        <td className="px-6 py-3 text-center text-blue-600 font-medium">{h.realDurationText || `${h.durationMinutes} min`}</td>
                                        <td className="px-6 py-3 text-center font-mono font-bold text-gray-800">+{h.hoursAdded} h</td>
                                        <td className="px-6 py-3 text-center text-xs font-mono">{h.startFuel}% <span className="text-gray-400">→</span> {h.endFuel}%</td>
                                    </tr>
                                ))}
                                {filteredHistory.length === 0 && (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-gray-400">No se encontraron registros.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="md:hidden">
                        {filteredHistory.length > 0 ? filteredHistory.slice(0, 10).map(h => (
                            <div key={h.id} className="p-5 border-b border-gray-100 last:border-0 active:bg-gray-50 transition">
                                <div className="flex justify-between mb-2">
                                    <span className="font-bold text-gray-800 text-sm">{h.machineName}</span>
                                    <span className="text-xs text-gray-500">{h.timestamp ? new Date(h.timestamp.seconds * 1000).toLocaleDateString() : '-'}</span>
                                </div>
                                <div className="flex justify-between items-center mb-2">
                                    <span className={`text-[10px] uppercase px-2 py-1 rounded-md font-bold ${h.type === 'Programado' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>{h.type}</span>
                                    <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded text-gray-600">{h.hm_done_at} h</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <p className="text-xs text-gray-500 line-clamp-1 flex-1 mr-4">{h.description}</p>
                                    <button onClick={() => setReportData(h)} className="flex items-center text-xs bg-white border border-gray-200 text-indigo-600 px-3 py-1.5 rounded-lg font-bold shadow-sm active:scale-95 transition"><FileText className="w-3 h-3 mr-1.5"/> Informe</button>
                                </div>
                            </div>
                        )) : (
                            <p className="p-8 text-center text-gray-400 text-sm">No hay registros.</p>
                        )}
                    </div>
                </div>
            )}

            {viewMode === 'kits' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="flex space-x-2 overflow-x-auto pb-2">
                            {PM_TYPES.map(pm => (
                                <button key={pm} onClick={() => setSelectedPmType(pm)} className={`px-5 py-3 rounded-xl font-bold text-sm transition whitespace-nowrap ${selectedPmType === pm ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-100'}`}>Kit {pm}</button>
                            ))}
                        </div>
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center"><h3 className="font-bold text-gray-800">Items definidos para {selectedPmType}</h3><span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg font-bold">{currentPmConfig.length} items</span></div>
                            {currentPmConfig.length === 0 ? (<div className="p-8 text-center text-gray-400"><Package className="w-12 h-12 mx-auto mb-2 opacity-20"/><p>No hay items configurados.</p></div>) : (
                                <div className="divide-y divide-gray-100">{currentPmConfig.map((item, index) => (<div key={index} className="p-4 flex items-center justify-between hover:bg-gray-50 transition"><div className="flex items-center gap-3"><div className={`w-2 h-10 rounded-full ${item.isMandatory ? 'bg-red-500' : 'bg-blue-300'}`}></div><div><p className="font-bold text-gray-800">{item.name}</p><p className="text-xs text-gray-500">Cantidad: <span className="font-bold">{item.qty}</span><span className="mx-2">•</span>{item.isMandatory ? <span className="text-red-600 font-bold">Obligatorio</span> : <span className="text-blue-600">Opcional</span>}</p></div></div>{canManageKits && <button onClick={() => removeKitItem(index)} className="text-gray-400 hover:text-red-500 p-2 transition"><X className="w-5 h-5"/></button>}</div>))}</div>
                            )}
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-fit">
                        <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center"><Plus className="w-5 h-5 mr-2 text-indigo-600"/> Agregar al Kit</h3>
                        {canManageKits ? (
                            <form onSubmit={handleAddKitItem} className="space-y-4">
                                <div><label className="block text-sm font-bold text-gray-700 mb-1.5">Suministro</label><select className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition" value={kitForm.supplyId} onChange={(e) => setKitForm({...kitForm, supplyId: e.target.value})}><option value="">Seleccionar...</option>{supplies.map(s => (<option key={s.id} value={s.id}>{s.name} (Stock: {s.stock})</option>))}</select></div>
                                <div><label className="block text-sm font-bold text-gray-700 mb-1.5">Cantidad Requerida</label><input type="number" min="1" className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition" value={kitForm.qty} onChange={(e) => setKitForm({...kitForm, qty: e.target.value})} /></div>
                                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100"><input type="checkbox" id="mandatory" className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500" checked={kitForm.isMandatory} onChange={(e) => setKitForm({...kitForm, isMandatory: e.target.checked})} /><label htmlFor="mandatory" className="text-sm font-medium text-gray-700 cursor-pointer select-none">Es Obligatorio</label></div>
                                <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 active:scale-95">Agregar Item</button>
                            </form>
                        ) : (
                            <div className="p-4 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-center text-sm text-gray-500">
                                <Lock className="w-8 h-8 mx-auto mb-2 text-gray-300"/>
                                Solo administradores pueden modificar los kits.
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={`Registrar ${type}`}>
                <form onSubmit={handleSave} className="space-y-5">
                    <div><label className="block text-sm font-bold mb-1.5 text-gray-700">HM Final (Min: {selectedMachine?.current_hm})</label><input type="number" required min={selectedMachine?.current_hm} value={formData.hm} onChange={e => setFormData({...formData, hm: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl text-base font-mono focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white transition" /></div>
                    
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-bold text-gray-700">Nivel de Combustible</label>
                            <span className="font-bold text-indigo-600">{formData.fuel_level}%</span>
                        </div>
                        <input type="range" min="0" max="100" value={formData.fuel_level} onChange={e => setFormData({...formData, fuel_level: e.target.value})} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"/>
                        <div className="flex justify-between text-xs text-gray-400 mt-1"><span>0%</span><span>50%</span><span>100%</span></div>
                    </div>

                    <div><label className="block text-sm font-bold mb-1.5 text-gray-700">Descripción</label><input type="text" required value={formData.desc} onChange={e => setFormData({...formData, desc: e.target.value})} className="w-full border border-gray-200 p-3 rounded-xl text-base focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="Ej: Cambio de Aceite..." /></div>
                    
                   
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <label className="block text-sm font-bold mb-3 text-indigo-700">Evidencia (Máx 3)</label>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            {formData.images.map((img, idx) => (
                                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-gray-300 group">
                                    <img src={img} alt="preview" className="w-full h-full object-cover" />
                                    <button type="button" onClick={() => handleRemoveImage(idx)} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-80 hover:opacity-100">
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                            {formData.images.length < 3 && (
                                <label className="flex flex-col items-center justify-center aspect-square border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-100 transition">
                                    <Camera className="w-6 h-6 text-gray-400" />
                                    <span className="text-[10px] text-gray-500 mt-1">Subir Foto</span>
                                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                                </label>
                            )}
                        </div>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <label className="block text-sm font-bold mb-3 text-indigo-700">Suministros (Opcional)</label>
                        <div className="flex items-end gap-2 mb-3"> 
                            <div className="flex-1">
                                <select 
                                    className="w-full border border-gray-200 p-3 rounded-xl text-base bg-white focus:ring-2 focus:ring-indigo-500 outline-none h-12" 
                                    value={tempSupplyId} 
                                    onChange={e => setTempSupplyId(e.target.value)}
                                >
                                    <option value="">Seleccionar...</option>
                                    {supplies.filter(s => s.stock > 0).map(s => (<option key={s.id} value={s.id}>{s.name} (Disp: {s.stock})</option>))}
                                </select>
                            </div>
                            <div className="w-20">
                                <input 
                                    type="number" 
                                    min="1" 
                                    className="w-full border border-gray-200 p-3 rounded-xl text-base text-center bg-white focus:ring-2 focus:ring-indigo-500 outline-none h-12" 
                                    value={tempQty} 
                                    onChange={e => setTempQty(e.target.value)} 
                                />
                            </div>
                            <button 
                                type="button" 
                                onClick={addSupplyToUsage} 
                                className="bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 active:scale-95 transition flex items-center justify-center shadow-md h-12 w-12 flex-shrink-0"
                            >
                                <Plus className="w-6 h-6" />
                            </button>
                        </div>
                        {formData.usedSupplies.length > 0 && (
                            <div className="space-y-2 mt-2">
                                {formData.usedSupplies.map(item => (
                                    <div key={item.id} className={`flex justify-between items-center bg-white p-3 rounded-lg border shadow-sm ${item.isMandatory ? 'border-red-200 bg-red-50' : 'border-gray-100'}`}>
                                        <div className="flex items-center gap-2">
                                            {item.isMandatory && <Lock className="w-4 h-4 text-red-500" />}
                                            <span className="text-sm font-medium text-gray-700">{item.qty} x {item.name}</span>
                                        </div>
                                        <button 
                                            type="button" 
                                            onClick={() => setFormData(prev => ({...prev, usedSupplies: prev.usedSupplies.filter(s => s.id !== item.id)}))} 
                                            className={`p-1 rounded-full transition ${item.isMandatory ? 'text-red-300 hover:text-red-500 hover:bg-red-100' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                                            title={item.isMandatory ? 'Item Obligatorio' : 'Eliminar'}
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="pt-4 flex justify-end"><button type="submit" className="w-full md:w-auto bg-green-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-green-200 hover:bg-green-700 transition active:scale-95"><Save className="w-5 h-5 mr-2 inline" /> Registrar</button></div>
                </form>
            </Modal>
        </div>
    );
};

const MachineUsageSection = ({ userId, userName, machines, currentJob, setCurrentJob, showMessage, history, userRole }) => {
    const [search, setSearch] = useState('');
    const [endHm, setEndHm] = useState('');
    const [endFuel, setEndFuel] = useState('');
    const [modalOpen, setModalOpen] = useState(false);

    const canOperate = userRole === 'Administrador' || userRole === 'Instructor';

    const startJob = async (machine) => {
        if (!canOperate) return showMessage('No tienes permisos para operar', 'error');
        if(currentJob) return showMessage('Ya tienes un trabajo activo', 'error');

        // VALIDACIÓN DE BLOQUEO: Si el equipo ha excedido el límite de tolerancia para su PM
        // Tolerancia definida en BLOCK_THRESHOLD (15 horas)
        if (machine.current_hm > machine.next_pm_due_hm + BLOCK_THRESHOLD) {
            return showMessage(`Bloqueado: PM Vencido hace más de ${BLOCK_THRESHOLD}h. Realice mantenimiento.`, 'error');
        }

        const jobData = { machineId: machine.id, machineName: machine.name, startHm: machine.current_hm, startTime: Date.now(), operator: userName, startFuel: machine.fuel_level || 100 };
        try { await updateDoc(doc(getCollectionRef('machines', userId), machine.id), { is_in_use: true }); setCurrentJob(jobData); showMessage(`Operando ${machine.name}`, 'success'); } catch(e) { showMessage('Error al iniciar', 'error'); }
    };

    const endJob = async (e) => {
        e.preventDefault();
        const endHmInt = parseInt(endHm);
        const endFuelInt = parseInt(endFuel);

        if(endHmInt < currentJob.startHm) return showMessage('HM Final inválido', 'error');
        if(isNaN(endFuelInt) || endFuelInt < 0 || endFuelInt > 100) return showMessage('Nivel de combustible inválido', 'error');
        
        if (endFuelInt < currentJob.startFuel - 50) {
            if(!window.confirm("El consumo de combustible parece alto (>50% en un turno). ¿Confirmar?")) return;
        }

        try {
            const durationMs = Date.now() - currentJob.startTime; const durationMin = Math.round(durationMs / 60000); const hoursAdded = endHmInt - currentJob.startHm;
            const batch = writeBatch(db); 
            batch.update(doc(getCollectionRef('machines', userId), currentJob.machineId), { is_in_use: false, current_hm: endHmInt, fuel_level: endFuelInt });
            batch.set(doc(getCollectionRef('usage_history', userId)), { 
                ...currentJob, 
                endTime: Date.now(), 
                endHm: endHmInt, 
                endFuel: endFuelInt,
                durationMinutes: durationMin, 
                hoursAdded, 
                realDurationText: formatDuration(durationMs) 
            });
            await batch.commit(); setCurrentJob(null); setModalOpen(false); setEndHm(''); setEndFuel(''); showMessage('Trabajo finalizado', 'success');
        } catch(e) { showMessage('Error al finalizar', 'error'); }
    };

    return (
        <div className="space-y-6 pb-24 md:pb-0">
            {currentJob && (
                <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white p-6 rounded-2xl shadow-lg shadow-orange-200 flex flex-col md:flex-row justify-between items-center animate-pulse border-2 border-white/20">
                    <div className="mb-4 md:mb-0 text-center md:text-left">
                        <h2 className="text-xl md:text-2xl font-bold flex items-center justify-center md:justify-start"><Clock className="w-8 h-8 mr-3" /> Operando: {currentJob.machineName}</h2>
                        <p className="opacity-90 mt-1 text-sm">Inicio: {new Date(currentJob.startTime).toLocaleTimeString()} • HM: {currentJob.startHm} h • Combustible: {currentJob.startFuel}%</p>
                    </div>
                    {canOperate && (
                        <button onClick={() => { setEndFuel(currentJob.startFuel); setModalOpen(true); }} className="bg-white text-orange-700 px-6 py-3 rounded-xl font-bold hover:bg-gray-50 shadow-lg transition flex items-center active:scale-95">
                            <StopCircle className="w-5 h-5 mr-2" /> Finalizar Turno
                        </button>
                    )}
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{machines.filter(m => !m.is_in_use && m.name.toLowerCase().includes(search.toLowerCase())).map(m => {
               
                const isBlocked = m.current_hm > m.next_pm_due_hm + BLOCK_THRESHOLD;
                
                return (
                    <div key={m.id} className={`bg-white p-5 rounded-2xl shadow-sm hover:shadow-md transition border-l-4 ${isBlocked ? 'border-gray-400 bg-gray-50' : 'border-green-500'} flex flex-col justify-between min-h-[160px]`}>
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="font-bold text-lg text-gray-800 leading-tight">{m.name}</h4>
                                <p className="text-gray-500 text-sm mt-1">{m.model}</p>
                            </div>
                            <div className="bg-gray-50 p-2 rounded-lg font-mono text-sm font-bold text-indigo-600">{m.current_hm} h</div>
                        </div>
                        <div className="mb-2"><FuelGauge percentage={m.fuel_level || 0} /></div>
                        
                        {isBlocked ? (
                             <div className="mt-4 w-full py-3 rounded-xl font-bold flex justify-center items-center bg-red-50 text-red-500 border border-red-100 text-xs uppercase">
                                <AlertOctagon className="w-4 h-4 mr-2" /> Bloqueado: PM Vencido
                            </div>
                        ) : (
                            canOperate ? (
                                <button onClick={() => startJob(m)} disabled={!!currentJob} className={`mt-4 w-full py-3 rounded-xl font-bold flex justify-center items-center transition active:scale-95 ${currentJob ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'}`}><Play className="w-4 h-4 mr-2" /> Iniciar Operación</button>
                            ) : (
                                <div className="mt-4 w-full py-3 rounded-xl font-bold flex justify-center items-center bg-gray-50 text-gray-400 border border-dashed border-gray-200 text-xs italic">Modo Espectador</div>
                            )
                        )}
                    </div>
                )
            })}</div>
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100 mt-8"><div className="p-4 border-b flex justify-between items-center bg-gray-50"><h3 className="font-bold text-gray-700 flex items-center"><History className="w-5 h-5 mr-2 text-indigo-500"/> Historial de Operaciones</h3></div><div className="hidden md:block overflow-x-auto"><table className="w-full text-sm text-left text-gray-600"><thead className="bg-gray-50 text-xs uppercase text-gray-700 font-bold"><tr><th className="px-6 py-3">Fecha</th><th className="px-6 py-3">Equipo</th><th className="px-6 py-3">Operador</th><th className="px-6 py-3 text-center">Tiempo Real</th><th className="px-6 py-3 text-center">HM (+Horas)</th><th className="px-6 py-3 text-center">Combustible</th></tr></thead><tbody>{history.map(h => (<tr key={h.id} className="border-b hover:bg-gray-50"><td className="px-6 py-3">{h.endTime ? new Date(h.endTime).toLocaleDateString() : '-'}</td><td className="px-6 py-3 font-medium text-gray-900">{h.machineName}</td><td className="px-6 py-3">{h.operator || 'Desconocido'}</td><td className="px-6 py-3 text-center text-blue-600 font-medium">{h.realDurationText || `${h.durationMinutes} min`}</td><td className="px-6 py-3 text-center font-mono font-bold text-gray-800">+{h.hoursAdded} h</td><td className="px-6 py-3 text-center text-xs font-mono">{h.startFuel}% <span className="text-gray-400">→</span> {h.endFuel}%</td></tr>))}{history.length === 0 && <tr><td colSpan="6" className="text-center py-8 text-gray-400">Sin registros</td></tr>}</tbody></table></div><div className="md:hidden">{history.slice(0, 10).map(h => (<div key={h.id} className="p-5 border-b border-gray-100 last:border-0 active:bg-gray-50"><div className="flex justify-between mb-2"><span className="font-bold text-gray-800 text-sm">{h.machineName}</span><span className="text-xs text-gray-500">{h.endTime ? new Date(h.endTime).toLocaleDateString() : '-'}</span></div><div className="text-xs text-gray-500 mb-2">Op: {h.operator || 'Desc.'}</div><div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100"><div className="text-center"><span className="block text-[10px] uppercase text-gray-400 font-bold">Real</span><span className="text-sm font-bold text-blue-600">{h.realDurationText || `${h.durationMinutes}m`}</span></div><div className="text-center"><span className="block text-[10px] uppercase text-gray-400 font-bold">HM</span><span className="text-sm font-mono font-bold text-gray-800">+{h.hoursAdded} h</span></div><div className="text-center"><span className="block text-[10px] uppercase text-gray-400 font-bold">Fuel</span><span className="text-sm font-mono font-bold text-gray-800">{h.endFuel}%</span></div></div></div>))}</div></div>
            
            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Finalizar Turno">
                <form onSubmit={endJob} className="space-y-6">
                    <div>
                        <label className="block font-bold mb-2 text-gray-700 text-center">Horómetro Final</label>
                        <div className="text-center text-xs text-gray-500 mb-2">Mínimo aceptado: {currentJob?.startHm} h</div>
                        <input type="number" required min={currentJob?.startHm} value={endHm} onChange={e => setEndHm(e.target.value)} className="w-full border border-gray-200 p-4 rounded-2xl text-3xl font-mono text-center focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition" autoFocus />
                    </div>
                    
                    <div>
                         <label className="block font-bold mb-2 text-gray-700 text-center">Nivel de Combustible Final</label>
                         <div className="flex items-center justify-center gap-4">
                            <span className="text-xl font-bold text-indigo-600">{endFuel}%</span>
                         </div>
                         <input type="range" min="0" max="100" value={endFuel} onChange={e => setEndFuel(e.target.value)} className="w-full h-4 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-2"/>
                         <div className="flex justify-between text-xs text-gray-400 mt-1 px-1"><span>0%</span><span>Inicio: {currentJob?.startFuel}%</span><span>100%</span></div>
                    </div>

                    <button type="submit" className="w-full bg-red-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-red-200 hover:bg-red-700 transition active:scale-95 text-lg">Confirmar Fin</button>
                </form>
            </Modal>
        </div>
    );
};



export default function App() {
    const [user, setUser] = useState(null);
    const [authReady, setAuthReady] = useState(false);
    const [userId, setUserId] = useState(null);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [message, setMessage] = useState(null);

    const [machines, setMachines] = useState([]);
    const [supplies, setSupplies] = useState([]);
    const [usersList, setUsersList] = useState([]);
    const [maintenanceHistory, setMHistory] = useState([]);
    const [usageHistory, setUHistory] = useState([]);
    const [currentJob, setCurrentJob] = useState(null);
    const [pmConfigs, setPmConfigs] = useState({});

    // BUSCA ESTO Y BORRALO O REEMPLÁZALO:
// PEGA ESTO EN SU LUGAR (Dentro de la función App):
    useEffect(() => {
        // 1. Iniciamos sesión anónima directamente
        const init = async () => {
            try {
                await signInAnonymously(auth);
            } catch (error) {
                console.error("Error al iniciar sesión:", error);
            }
        };

        // 2. Escuchamos cambios en la autenticación
        const unsub = onAuthStateChanged(auth, (u) => {
            if (u) {
                setUserId(u.uid);
                setAuthReady(true);
            } else {
                setUserId(null);
                setAuthReady(false);
            }
        });

        init();
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!userId) return;
        const unsubMachines = onSnapshot(getCollectionRef('machines', userId), snap => { let data = snap.docs.map(d => ({id: d.id, ...d.data()})); setMachines(data); if(data.length === 0) DUMMY_MACHINES.forEach(m => setDoc(doc(getCollectionRef('machines', userId), m.id), m)); });
        const unsubSupplies = onSnapshot(getCollectionRef('supplies', userId), snap => { let data = snap.docs.map(d => ({id: d.id, ...d.data()})); setSupplies(data); if(data.length === 0) DUMMY_SUPPLIES.forEach(s => setDoc(doc(getCollectionRef('supplies', userId), s.id), s)); });
        const unsubUsers = onSnapshot(getCollectionRef('users_list', userId), snap => { let data = snap.docs.map(d => ({id: d.id, ...d.data()})); setUsersList(data); if(data.length === 0) DUMMY_AUTH_DB.forEach(u => setDoc(doc(getCollectionRef('users_list', userId), u.id), u)); });
        const unsubMHistory = onSnapshot(query(getCollectionRef('maintenance_history', userId), limit(50)), snap => { setMHistory(snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => (b.timestamp?.seconds||0) - (a.timestamp?.seconds||0))); });
        const unsubUHistory = onSnapshot(query(getCollectionRef('usage_history', userId), limit(50)), snap => { setUHistory(snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => b.endTime - a.endTime)); });
        const unsubPmConfigs = onSnapshot(getCollectionRef('pm_configs', userId), snap => {
            const configs = {};
            snap.docs.forEach(doc => { configs[doc.id] = doc.data().items || []; });
            setPmConfigs(configs);
        });
        return () => { unsubMachines(); unsubSupplies(); unsubMHistory(); unsubUHistory(); unsubUsers(); unsubPmConfigs(); };
    }, [userId]);

    const showMessage = (text, type) => { setMessage({ text, type }); setTimeout(() => setMessage(null), 4000); };

    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
        { id: 'machines', label: 'Flota', icon: Truck },
        { id: 'usage', label: 'Operaciones', icon: Clock },
        { id: 'maintenance', label: 'Mantenimiento', icon: Wrench },
        { id: 'inventory', label: 'Inventario', icon: Package },
    ];

    if (user?.role === 'Administrador' || user?.role === 'Instructor') navItems.push({ id: 'users', label: 'Usuarios', icon: Users });

    if (!authReady) return <Loader />;
    if (!user) return <LoginScreen onLogin={setUser} />;

    return (
        <div className="min-h-[100dvh] bg-gray-50 font-sans flex flex-col md:flex-row text-gray-900">
  
            <aside className="bg-slate-900 text-white w-72 flex-shrink-0 hidden md:flex flex-col h-screen sticky top-0 print:hidden shadow-2xl z-30">
                <div className="p-8 border-b border-slate-800"><div className="flex items-center gap-3"><div className="bg-indigo-600 p-2 rounded-lg"><Truck className="w-6 h-6 text-white" /></div><div><h1 className="font-bold text-xl tracking-wide text-white">HeavyGest</h1><p className="text-xs text-slate-400 font-medium">Enterprise Edition</p></div></div></div>
                <nav className="flex-1 p-4 space-y-2 overflow-y-auto">{navItems.map(item => (<button key={item.id} onClick={() => setActiveTab(item.id)} className={`w-full flex items-center p-3.5 rounded-xl transition duration-200 group ${activeTab === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><item.icon className={`w-5 h-5 mr-3 transition-colors ${activeTab === item.id ? 'text-white' : 'text-slate-500 group-hover:text-white'}`} /> <span className="font-medium text-sm">{item.label}</span></button>))}</nav>
                <div className="p-6 border-t border-slate-800 bg-slate-900/50"><div className="flex items-center gap-3 mb-4 px-2"><div className="bg-gradient-to-br from-indigo-500 to-purple-600 w-10 h-10 rounded-full flex items-center justify-center font-bold shadow-lg text-white border-2 border-slate-700">{user.username[0].toUpperCase()}</div><div className="overflow-hidden"><p className="font-bold text-sm truncate text-white">{user.username}</p><p className="text-xs text-slate-400 truncate">{user.role}</p></div></div><button onClick={() => setUser(null)} className="w-full bg-slate-800 hover:bg-red-600/90 py-3 rounded-xl text-xs font-bold flex justify-center items-center transition text-slate-300 hover:text-white border border-slate-700 hover:border-transparent"><LogOut className="w-4 h-4 mr-2" /> Cerrar Sesión</button></div>
            </aside>
            
            <div className="md:hidden bg-slate-900 text-white px-6 py-3 flex justify-between items-center fixed top-0 left-0 right-0 z-50 shadow-lg print:hidden min-h-[4rem] h-auto pt-safe transition-all duration-300">
                <div className="flex items-center gap-2"><div className="bg-indigo-600 p-1.5 rounded-lg"><Truck className="w-5 h-5 text-white"/></div><span className="font-bold text-lg tracking-tight">HeavyGest</span></div>
                <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold border border-slate-700">{user.username[0].toUpperCase()}</div><button onClick={() => setUser(null)} className="text-slate-400 hover:text-white transition"><LogOut className="w-5 h-5"/></button></div>
            </div>

            <main 
                className="flex-1 p-4 md:p-8 overflow-y-auto h-auto md:h-screen print:p-0 print:h-auto print:overflow-visible bg-gray-50/50 pb-28 md:pb-8"
                style={{ paddingTop: 'calc(4rem + env(safe-area-inset-top) + 1rem)' }}
            >
                <header className="flex flex-row justify-between items-center mb-6 gap-4 print:hidden md:mb-8">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-2xl font-extrabold text-slate-900 capitalize tracking-tight truncate">{navItems.find(n => n.id === activeTab)?.label}</h2>
                        <p className="text-sm text-gray-500 hidden md:block font-medium mt-1">Bienvenido de nuevo, {user.username}</p>
                    </div>
                    
                    <div className="flex items-center gap-3 shrink-0">
                        <NotificationCenter machines={machines} supplies={supplies} />
                        {currentJob && activeTab !== 'usage' && (
                            <button onClick={() => setActiveTab('usage')} className="flex items-center justify-center bg-orange-100 text-orange-700 px-3 py-2 md:px-4 md:py-2.5 rounded-xl text-xs md:text-sm font-bold animate-pulse border border-orange-200 hover:bg-orange-200 transition shadow-sm active:scale-95">
                                <Play className="w-4 h-4 md:mr-2 fill-current" /> 
                                <span className="hidden md:inline truncate max-w-[150px]">En uso: {currentJob.machineName}</span>
                                <span className="md:hidden">En uso</span>
                            </button>
                        )}
                    </div>
                </header>

                {activeTab === 'dashboard' && <DashboardOverview machines={machines} supplies={supplies} maintenanceHistory={maintenanceHistory} usageHistory={usageHistory} />}
                {activeTab === 'machines' && <MachineManagementSection userId={userId} machines={machines} showMessage={showMessage} userRole={user.role} />}
                {activeTab === 'inventory' && <InventorySection userId={userId} supplies={supplies} showMessage={showMessage} userRole={user.role} />}
                {activeTab === 'maintenance' && <MaintenanceSection userId={userId} machines={machines} supplies={supplies} history={maintenanceHistory} pmConfigs={pmConfigs} showMessage={showMessage} userRole={user.role} />}
                {activeTab === 'usage' && <MachineUsageSection userId={userId} userName={user.username} machines={machines} currentJob={currentJob} setCurrentJob={setCurrentJob} history={usageHistory} showMessage={showMessage} userRole={user.role} />}
                {activeTab === 'users' && <UserManagementSection userId={userId} users={usersList} showMessage={showMessage} userRole={user.role} />}
            </main>

            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-gray-200 flex justify-around items-center z-40 pb-safe print:hidden shadow-[0_-4px_10px_rgba(0,0,0,0.03)] safe-padding">
                {navItems.map(item => (
                    <button key={item.id} onClick={() => setActiveTab(item.id)} className={`flex flex-col items-center justify-center w-full py-3 transition-all duration-200 active:scale-90 ${activeTab === item.id ? 'text-indigo-600' : 'text-gray-400'}`}>
                        <div className={`mb-1 p-1 rounded-lg transition-all duration-200 ${activeTab === item.id ? 'bg-indigo-50 -translate-y-1' : ''}`}>
                            <item.icon className={`w-6 h-6 ${activeTab === item.id ? 'fill-current' : ''}`} />
                        </div>
                        <span className={`text-[10px] font-bold leading-none ${activeTab === item.id ? 'opacity-100' : 'opacity-70'}`}>{item.label}</span>
                    </button>
                ))}
            </div>
            <GlobalToast message={message} onClose={() => setMessage(null)} />

            <style>{`
                .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
                .pt-safe { padding-top: env(safe-area-inset-top); }
                .safe-padding { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }
                
                @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
                
                @keyframes slide-up-mobile { from { transform: translateY(100%); } to { transform: translateY(0); } }
                .animate-slide-up-mobile { animation: slide-up-mobile 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
                
                @keyframes bounce-in { 
                    0% { transform: scale(0.9); opacity: 0; } 
                    60% { transform: scale(1.05); opacity: 1; } 
                    100% { transform: scale(1); opacity: 1; } 
                }
                .animate-bounce-in { animation: bounce-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
            `}</style>
        </div>
    );
}
