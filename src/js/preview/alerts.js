// js/preview/alerts.js — GFM Alerts / Callouts ([!NOTE], [!TIP]...) trong preview.

import { previewOutput } from '../core/dom.js';

function getAlertIcon(type) {
    switch (type) {
        case 'NOTE': return 'info';
        case 'TIP': return 'lightbulb';
        case 'IMPORTANT': return 'alert-circle';
        case 'WARNING': return 'alert-triangle';
        case 'CAUTION': return 'ban';
        default: return 'info';
    }
}

function getAlertTitle(type) {
    switch (type) {
        case 'NOTE': return 'Note';
        case 'TIP': return 'Tip';
        case 'IMPORTANT': return 'Important';
        case 'WARNING': return 'Warning';
        case 'CAUTION': return 'Caution';
        default: return type;
    }
}

export function processGFMAlerts() {
    previewOutput.querySelectorAll('blockquote').forEach((bq) => {
        const firstP = bq.querySelector('p');
        if (firstP) {
            const htmlContent = firstP.innerHTML.trim();
            // Marker [!TYPE] ở đầu đoạn (có thể kèm <br> theo sau)
            const match = htmlContent.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i);
            
            if (match) {
                const type = match[1].toUpperCase();
                // Gỡ marker [!TYPE] khỏi nội dung
                firstP.innerHTML = firstP.innerHTML.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i, '');
                bq.classList.add('markdown-alert', `markdown-alert-${type.toLowerCase()}`);
                
                if (!bq.querySelector('.markdown-alert-title')) {
                    const titleP = document.createElement('p');
                    titleP.className = 'markdown-alert-title';
                    titleP.innerHTML = `<i data-lucide="${getAlertIcon(type)}"></i>${getAlertTitle(type)}`;
                    bq.insertBefore(titleP, bq.firstChild);
                }
            }
        }
    });
}
