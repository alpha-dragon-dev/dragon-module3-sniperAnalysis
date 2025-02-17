document.addEventListener('DOMContentLoaded', function () {
  const addressInput = document.querySelector('.address-input');
  let timelineChart = null;
  let fetchInterval = null;

  // Automatically focus the contract address input field on page load
  addressInput.focus();

  function showChartLoadingIndicator(show) {
    const loadingEl = document.getElementById('chartLoading');
    if (loadingEl) {
      loadingEl.style.display = show ? 'block' : 'none';
    }
  }

  // When user presses Enter in the address field
  addressInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const contractAddress = e.target.value.trim();
      if (!contractAddress) {
        console.warn('[WARN] Contract address is empty!');
        return;
      }

      console.log('[INFO] New contract address entered:', contractAddress);
      showChartLoadingIndicator(true);

      try {
        // 1) Clear existing data on your backend
        await clearAPIData();

        // 2) Send the contract address to your Telegram bridge (or similar)
        await sendContractAddressToBot(contractAddress);

        // 3) Start/Poll fetch data
        if (fetchInterval) clearInterval(fetchInterval);
        await renderSniperChart();
        fetchInterval = setInterval(renderSniperChart, 10_000);
      } catch (error) {
        console.error('[ERROR] Error in address input flow:', error);
      } finally {
        showChartLoadingIndicator(false);
      }
    }
  });

  async function clearAPIData() {
    try {
      const response = await fetch('http://localhost:3000/clearData', {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(
          `[ERROR] Failed to clear data. Status: ${response.status}`
        );
      }
      console.log('[INFO] API data cleared successfully.');
    } catch (error) {
      console.error('[ERROR] Error clearing API data:', error);
      throw error;
    }
  }

  async function sendContractAddressToBot(contractAddress) {
    try {
      const apiEndpoint = 'http://localhost:3001/sendContractAddress';
      console.log('[INFO] Sending contract address to bot:', contractAddress);

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress }),
      });

      if (!response.ok) {
        throw new Error(
          `[ERROR] Failed to send contract address. Status: ${response.status}`
        );
      }
      console.log('[INFO] Contract address sent successfully:', contractAddress);
    } catch (error) {
      console.error('[ERROR] Failed to send contract address:', error);
      throw error;
    }
  }

  async function fetchSniperData() {
    try {
      const response = await fetch('http://localhost:3000/fetchData');
      if (!response.ok) {
        throw new Error(`[Sniper] HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[Sniper] Error fetching data:', error);
      return null;
    }
  }

  // Extracting logic as in your original code
  function extractSnipedPercent(line) {
    const match = line.match(/🔫(?: Sniped)?\s+([\d.]+)%/);
    return match ? parseFloat(match[1]) : null;
  }
  function extractHoldsPercent(line) {
    const match = line.match(/Holds\s+([\d.]+)%/);
    return match ? parseFloat(match[1]) : null;
  }
  function isEntityLine(line) {
    return (
      line.trim().startsWith('└👷') ||
      line.trim().startsWith('└ 👷') ||
      line.trim().startsWith('└ 👤') ||
      line.trim().startsWith('└ 🤖')
    );
  }
  function extractTimestampLabel(line) {
    const block0Match = line.match(/Block\s*(\d+)\s*Snipe/);
    if (block0Match) {
      return `Block ${block0Match[1]}`;
    }
    if (line.includes('⌚️')) {
      return line.replace('└ ⌚️', '').trim();
    }
    return null;
  }
  function getSecondsFromLabel(label) {
    if (label.includes('Block 0')) {
      return 0;
    }
    let minSecMatch = label.match(/(\d+)min\s*(\d*)sec?/);
    if (minSecMatch) {
      const minutes = parseInt(minSecMatch[1], 10) || 0;
      const seconds = parseInt(minSecMatch[2], 10) || 0;
      return minutes * 60 + seconds;
    }
    let secMatch = label.match(/(\d+)\s*sec/);
    if (secMatch) {
      return parseInt(secMatch[1], 10);
    }
    return 999999;
  }

  function parseSniperData(allTokens) {
    const tokenData = allTokens.find(
      (item) => item['🎯 Snipers & First Buyers'] || item['🛠 Deployer']
    );
    if (!tokenData) {
      console.warn('[Sniper] No relevant sniper data found.');
      return { labels: [], snipedValues: [], holdsValues: [] };
    }

    // Dev info
    let devSniped = 0;
    let devHolds = 0;
    function parseDeveloperBlock(lines) {
      let capture = false;
      for (let line of lines) {
        if (isEntityLine(line)) {
          capture = line.includes('👷');
        } else if (capture) {
          const snipeVal = extractSnipedPercent(line);
          if (snipeVal !== null) devSniped = snipeVal;
          const holdVal = extractHoldsPercent(line);
          if (holdVal !== null) devHolds = holdVal;
        }
      }
    }

    const deployerLines = tokenData['🛠 Deployer'] || [];
    const sniperLines = tokenData['🎯 Snipers & First Buyers'] || [];
    parseDeveloperBlock(deployerLines);
    parseDeveloperBlock(sniperLines);

    // Parse non-developer sniper blocks
    let participants = [];
    let currentEntity = null;
    let currentBlockLines = [];

    function finalizeBlock() {
      if (!currentEntity || !currentBlockLines.length) return;
      if (currentEntity.includes('👷')) return;
      let timestampLabel = null;
      let sniped = null;
      let holds = 0;
      for (let line of currentBlockLines) {
        if (!timestampLabel) {
          const maybeTs = extractTimestampLabel(line);
          if (maybeTs) timestampLabel = maybeTs;
        }
        if (sniped === null) {
          const maybeSnipe = extractSnipedPercent(line);
          if (maybeSnipe !== null) sniped = maybeSnipe;
        }
        const maybeHold = extractHoldsPercent(line);
        if (maybeHold !== null) holds = maybeHold;
      }
      if (timestampLabel && sniped !== null) {
        const secs = getSecondsFromLabel(timestampLabel);
        if (secs <= 300) {
          participants.push({
            timestampLabel: secs + 's',
            sniped,
            holds,
          });
        }
      }
    }

    for (let line of sniperLines) {
      if (isEntityLine(line)) {
        finalizeBlock();
        currentEntity = line;
        currentBlockLines = [];
      } else if (currentEntity) {
        currentBlockLines.push(line);
      }
    }
    finalizeBlock();

    let labels = ['Dev'];
    let snipedValues = [devSniped];
    let holdsValues = [devHolds];

    for (let p of participants) {
      labels.push(p.timestampLabel);
      snipedValues.push(p.sniped);
      holdsValues.push(p.holds);
    }

    return { labels, snipedValues, holdsValues };
  }

  /*
    Updates the "Active Snipers" fields. 
    For demonstration, if the sum is 0 or the data is empty, we keep “Loading.....”.
  */
  function updateActiveSnipes() {
    const activeSnipesElement = document.getElementById('activeSnipersCount');
    const activeSnipersOutput = document.getElementById('activeSnipersOutput');
    if (!timelineChart) return;

    try {
      const holdsDataset = timelineChart.data?.datasets?.[0];
      if (!holdsDataset || !holdsDataset.data.length) {
        // No dataset means no data has been fetched yet
        if (activeSnipesElement) activeSnipesElement.textContent = 'Loading...';
        if (activeSnipersOutput) activeSnipersOutput.textContent = 'Loading...';
        return;
      }
      // If everything is zero, keep showing "Loading......"
      const totalHoldsSum = holdsDataset.data.reduce((acc, val) => acc + (val || 0), 0);
      if (totalHoldsSum === 0) {
        if (activeSnipesElement) activeSnipesElement.textContent = 'Loading...';
        if (activeSnipersOutput) activeSnipersOutput.textContent = 'Loading...';
        return;
      }

      // Count how many > 0
      const activeCount = holdsDataset.data.filter((v) => v > 0).length;

      if (activeSnipesElement) activeSnipesElement.textContent = activeCount;
      if (activeSnipersOutput) activeSnipersOutput.textContent = activeCount;

      // Danger color if too many
      if (activeCount > 3) {
        activeSnipesElement.classList.add('danger');
      } else {
        activeSnipesElement.classList.remove('danger');
      }
    } catch (err) {
      console.error('[Sniper] Failed to update active snipes:', err);
      if (activeSnipesElement) activeSnipesElement.textContent = 'Loading...';
      if (activeSnipersOutput) activeSnipersOutput.textContent = 'Loading...';
    }
  }

  /*
    Updates the "Total Holding" fields. 
    If total is 0, we again keep “Loading......” instead of showing “0.0%”.
  */
  function updateTotalSnipes() {
    const totalHoldingElement = document.getElementById('totalHoldingValue');
    const totalHoldingOutput = document.getElementById('totalHoldingOutput');
    if (!timelineChart) return;

    try {
      const holdsDataset = timelineChart.data?.datasets?.[0];
      if (!holdsDataset || !holdsDataset.data.length) {
        if (totalHoldingElement) totalHoldingElement.textContent = 'Loading...';
        if (totalHoldingOutput) totalHoldingOutput.textContent = 'Loading...';
        return;
      }
      let totalHolds = holdsDataset.data.reduce((acc, val) => acc + (val || 0), 0);

      if (totalHolds === 0) {
        if (totalHoldingElement) totalHoldingElement.textContent = 'Loading...';
        if (totalHoldingOutput) totalHoldingOutput.textContent = 'Loading...';
        return;
      }

      // Show actual value if non-zero
      if (totalHoldingElement) {
        totalHoldingElement.textContent = `${totalHolds.toFixed(3)}%`;
        if (totalHolds > 3) {
          totalHoldingElement.classList.add('danger');
        } else {
          totalHoldingElement.classList.remove('danger');
        }
      }
      if (totalHoldingOutput) {
        totalHoldingOutput.textContent = `${totalHolds.toFixed(3)}%`;
      }
    } catch (err) {
      console.error('[Sniper] Failed to update total holds:', err);
      if (totalHoldingElement) totalHoldingElement.textContent = 'Loading...';
      if (totalHoldingOutput) totalHoldingOutput.textContent = 'Loading...';
    }
  }

  async function renderSniperChart() {
    const timelineCtx = document.getElementById('timelineChart');
    if (!timelineCtx) {
      console.error('[Sniper] #timelineChart not found');
      return;
    }

    showChartLoadingIndicator(true);

    try {
      const rawData = await fetchSniperData();
      if (!rawData || !Array.isArray(rawData)) {
        throw new Error('[Sniper] No or invalid data from server');
      }

      // Once valid data is received, stop showing chart loading text
      showChartLoadingIndicator(false);

      const { labels, snipedValues, holdsValues } = parseSniperData(rawData);

      // Destroy old chart if it exists
      if (timelineChart instanceof Chart) {
        timelineChart.destroy();
      }

      timelineChart = new Chart(timelineCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Active',
              data: holdsValues,
              backgroundColor: 'rgba(255, 0, 0, 0.8)',
              maxBarThickness: 30,
              stack: 'sniperStack',
            },
            {
              label: 'Sold',
              data: snipedValues,
              backgroundColor: 'rgba(128, 128, 128, 1)',
              maxBarThickness: 30,
              stack: 'sniperStack',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            tooltip: {
              callbacks: {
                label: function (context) {
                  let label = context.dataset.label || '';
                  if (label) label += ': ';
                  if (context.raw !== null) {
                    label += `${context.raw}%`;
                  }
                  return label;
                },
              },
            },
          },
          scales: {
            x: { stacked: true },
            y: {
              beginAtZero: true,
              stacked: true,
              ticks: {
                callback: function (value) {
                  return value + '%';
                },
              },
            },
          },
        },
      });

      // Update the displayed stats
      updateTotalSnipes();
      updateActiveSnipes();
    } catch (error) {
      console.error('[Sniper] Error rendering chart:', error);
      // Keep loading indicator visible if no valid data is fetched
      showChartLoadingIndicator(true);
    }
  }
});