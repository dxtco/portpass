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
    // By removing the http://127.0.0.1:8000 part, it works everywhere!
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