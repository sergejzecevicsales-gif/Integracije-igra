'use strict';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => fmt0(value) + ' KM';
const shortStage = key => ({ competition2:'Konkurencija', oligopoly2:'Oligopol', monopoly:'Monopol', entry:'Novi konkurent' }[key] || key);
const dot = color => `<i class="swatch" style="background:${esc(color)}"></i>`;
