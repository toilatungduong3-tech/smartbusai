async function loadTrips(){

    const res = await fetch("http://localhost:2704/api/trips");
    const data = await res.json();

    let html = "";

    data.forEach(trip => {

        html += `
        <div class="trip">
            <h3>${trip.origin} → ${trip.destination}</h3>
            <p>Price: ${trip.base_price}</p>
        </div>
        `;
    });

    document.getElementById("tripList").innerHTML = html;
}