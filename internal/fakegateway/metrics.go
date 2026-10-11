package fakegateway

import (
	"encoding/json"
	"net/http"
	"time"
)

const (
	MetricsSummaryPath = "/admin/metrics/summary"
	TrafficMetricsPath = "/admin/metrics/traffic"
)

type trafficPoint struct {
	T          time.Time `json:"t"`
	Submitted  int       `json:"submitted"`
	Delivered  int       `json:"delivered"`
	Failed     int       `json:"failed"`
	MoReceived int       `json:"mo_received"`
}

type trafficSeries struct {
	Key    string         `json:"key"`
	Points []trafficPoint `json:"points"`
}

func ServeMetricsSummary(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{
		"window":             "5m",
		"submitted":          9000,
		"delivered":          8600,
		"failed":             300,
		"rejected":           100,
		"mo_received":        1500,
		"e2e_latency_ms_p50": 120,
		"e2e_latency_ms_p99": 840,
		"active_sessions":    12,
	})
}

func ServeTrafficMetrics(w http.ResponseWriter, r *http.Request) {
	groupBy := r.URL.Query().Get("groupBy")
	if groupBy == "" {
		groupBy = "connector"
	}

	end := time.Now().UTC().Truncate(10 * time.Second)
	points := make([]trafficPoint, 3)
	for i := range points {
		points[i] = trafficPoint{
			T:          end.Add(time.Duration(i-2) * 10 * time.Second),
			Submitted:  300 + 10*i,
			Delivered:  290 + 10*i,
			Failed:     10,
			MoReceived: 25,
		}
	}

	writeJSON(w, map[string]any{
		"group_by": groupBy,
		"window":   "5m",
		"series":   []trafficSeries{{Key: "other", Points: points}, {Key: "ungrouped", Points: points}},
	})
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}
