// ==========================================
// ENGINE GLOBAL REFERENCES
// ==========================================
// Keep a global tracking variable here to safely overwrite old map instances
let liveMapInstance = null;

// ==========================================
// CONTROLLER 1: INDEPENDENT TARIFF CALCULATOR
// ==========================================
document.getElementById('calcForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const hsnCode = document.getElementById('hsnInput').value;
    const assessableValue = parseFloat(document.getElementById('valueInput').value);

    // Dom elements states
    const placeholder = document.getElementById('placeholderState');
    const resultCard = document.getElementById('resultState');
    const errorCard = document.getElementById('errorState');

    // Reset view states
    errorCard.classList.add('hidden');

    try {
        const response = await fetch('/api/v1/calculate-indian-duty', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                hsn_code: hsnCode,
                assessable_value: assessableValue
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || 'Failed to process financial data calculations.');
        }

        // Hide default screen state, unhide dashboard metrics cards
        placeholder.classList.add('hidden');
        resultCard.classList.remove('hidden');

        // Format Currency Function Utility (Indian Format INR)
        const formatINR = (num) => '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Update Text node values dynamically
        document.getElementById('resDescription').innerText = data.meta.description;
        document.getElementById('resHsn').innerText = data.meta.hsn_code;

        const fin = data.financial_breakdown;
        document.getElementById('valCIF').innerText = formatINR(fin.assessable_value_cif);
        document.getElementById('valBcdBase').innerText = formatINR(fin.assessable_value_cif);
        document.getElementById('rateBcd').innerText = data.rates_applied.bcd_percentage;
        document.getElementById('valBcdAmt').innerText = formatINR(fin.basic_customs_duty_bcd);

        document.getElementById('valSwsBase').innerText = formatINR(fin.basic_customs_duty_bcd);
        document.getElementById('valSwsAmt').innerText = formatINR(fin.social_welfare_surcharge_sws);

        document.getElementById('valIgstBase').innerText = formatINR(fin.value_subject_to_igst);
        document.getElementById('valIgstCalcBase').innerText = formatINR(fin.value_subject_to_igst);
        document.getElementById('rateIgst').innerText = data.rates_applied.igst_percentage;
        document.getElementById('valIgstAmt').innerText = formatINR(fin.integrated_gst_igst);

        document.getElementById('valTotalDuty').innerText = formatINR(fin.total_duty_payable);
        document.getElementById('valLandedCost').innerText = formatINR(fin.total_landed_cost);

    } catch (err) {
        resultCard.classList.add('hidden');
        errorCard.classList.remove('hidden');
        errorCard.innerText = err.message;
    }
});


// ==========================================
// CONTROLLER 2: GLOBAL CARGO TRACKING HUB
// ==========================================
async function trackContainer() {
    const containerNum = document.getElementById('containerInput').value.trim();
    const resultDiv = document.getElementById('trackingResult');
    const placeholder = document.getElementById('placeholderState');
    
    if (!containerNum) {
        alert('Please provide a container number to search.');
        return;
    }

    try {
        // Step 1: Render the complete layout structure immediately so Leaflet has DOM anchors
        resultDiv.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        
        resultDiv.innerHTML = `
            <div id="trackingMetrics" class="md:col-span-2">
                <div class="bg-blue-50 border border-blue-200 text-blue-700 p-4 rounded-xl text-sm font-medium animate-pulse">
                    Scanning global infrastructure logistics networks...
                </div>
            </div>
            <div class="md:col-span-3 bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-col min-h-[320px]">
                <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Live AIS Corridor Position Tracking</h4>
                <div id="mapViewport" class="w-full flex-1 rounded-lg border border-gray-100 bg-slate-100 min-h-[250px]"></div>
            </div>`;

        // Step 2: Await network response payloads
        const response = await fetch('/api/v1/track-container', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ container_number: containerNum })
        });
        
        if (!response.ok) {
            throw new Error('Network tracking endpoint returned an error response.');
        }

        const data = await response.json();
        
        // Step 3: Swap ONLY the text content in the metrics pane (Don't touch the map container node!)
        document.getElementById('trackingMetrics').innerHTML = `
            <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-xs border-l-4 border-l-blue-600 h-full">
                <div class="flex justify-between items-center mb-3">
                    <span class="font-bold text-slate-900 text-sm">Asset ID: ${data.meta.container_number}</span>
                    <span class="text-[9px] font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-slate-600 uppercase tracking-wide">${data.meta.source}</span>
                </div>
                <hr class="border-gray-100 my-2.5">
                
                <div class="text-xs space-y-2.5 text-slate-700">
                    <p>🏛️ <strong>ICEGATE Customs:</strong> <span class="text-green-600 font-semibold">${data.customs_milestones.icegate_out_of_charge_ooc}</span></p>
                    <p>📦 <strong>Bill of Entry Status:</strong> <span class="font-medium text-slate-900">${data.customs_milestones.bill_of_entry_filed}</span></p>
                    <p>🚢 <strong>Carrier Asset Line:</strong> <span class="font-medium text-slate-900">${data.carrier_milestones.shipping_line || 'Verified Line'}</span></p>
                    <p>⚓ <strong>ODeX Delivery Order:</strong> <span class="text-blue-600 font-semibold">${data.carrier_milestones.odex_delivery_order_status}</span></p>
                    
                    <div class="mt-3 p-3 bg-slate-50 border border-gray-100 rounded-lg text-[11px] text-slate-600 leading-relaxed">
                        <strong class="text-slate-800 block mb-0.5">Current Operational Status:</strong>
                        ${data.carrier_milestones.current_status || data.carrier_milestones.status_description}
                    </div>
                </div>
            </div>`;

        // Step 4: Parse Dynamic Map Coordinates
        const targetLatitude = parseFloat(data.meta.latitude) || 18.9503;
        const targetLongitude = parseFloat(data.meta.longitude) || 72.9520;

        // Reset older Leaflet instances cleanly
        if (liveMapInstance) {
            liveMapInstance.remove();
            liveMapInstance = null;
        }

        // Spin up map frame engine directly into the layout viewport panel
        liveMapInstance = L.map('mapViewport').setView([targetLatitude, targetLongitude], 10);

        // Render crisp OpenStreetMap styling tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(liveMapInstance);

        // Place a personalized milestone tracking pin onto the custom coordinates
        L.marker([targetLatitude, targetLongitude])
            .addTo(liveMapInstance)
            .bindPopup(`<b>Container ${data.meta.container_number}</b><br>Status: ${data.carrier_milestones.current_status || 'In Transit'}`)
            .openPopup();

        // Step 5: Force Leaflet to recalculate bounds in case processing skewed elements
        setTimeout(() => {
            if (liveMapInstance) liveMapInstance.invalidateSize();
        }, 200);

    } catch (error) {
        console.error('Error tracking target package:', error);
        resultDiv.innerHTML = `
            <div class="col-span-5 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
                Unable to fetch real-time tracking streams. Please try again later.
            </div>`;
    }
}