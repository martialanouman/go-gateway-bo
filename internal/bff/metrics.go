package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

const (
	operationGetMetricsSummary = "get-metrics-summary"
	operationGetTrafficMetrics = "get-traffic-metrics"
)

func (a API) GetMetricsSummary(ctx context.Context, request GetMetricsSummaryRequestObject,
) (GetMetricsSummaryResponseObject, error) {
	var params gateway.GetMetricsSummaryParams
	if request.Params.Window != nil {
		window := string(*request.Params.Window)
		params.Window = &window
	}

	response, err := a.Gateway.GetMetricsSummaryWithResponse(ctx, &params)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.relayedRefusal(ctx, operationGetMetricsSummary, err)

		switch status {
		case http.StatusUnprocessableEntity:
			return GetMetricsSummary422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return GetMetricsSummary503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	summary := response.JSON200

	return GetMetricsSummary200JSONResponse{
		Window:          summary.Window,
		Submitted:       count(summary.Submitted),
		Delivered:       count(summary.Delivered),
		Failed:          count(summary.Failed),
		Rejected:        count(summary.Rejected),
		MoReceived:      count(summary.MoReceived),
		E2eLatencyMsP50: summary.E2eLatencyMsP50,
		E2eLatencyMsP99: summary.E2eLatencyMsP99,
		ActiveSessions:  summary.ActiveSessions,
	}, nil
}

func (a API) GetTrafficMetrics(ctx context.Context, request GetTrafficMetricsRequestObject,
) (GetTrafficMetricsResponseObject, error) {
	var params gateway.GetTrafficMetricsParams
	if request.Params.Window != nil {
		window := string(*request.Params.Window)
		params.Window = &window
	}

	if request.Params.GroupBy != nil {
		groupBy := gateway.GetTrafficMetricsParamsGroupBy(*request.Params.GroupBy)
		params.GroupBy = &groupBy
	}

	response, err := a.Gateway.GetTrafficMetricsWithResponse(ctx, &params)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.relayedRefusal(ctx, operationGetTrafficMetrics, err)

		switch status {
		case http.StatusUnprocessableEntity:
			return GetTrafficMetrics422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return GetTrafficMetrics503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	metrics := response.JSON200
	series := make([]TrafficSeries, 0, len(metrics.Series))

	for _, upstream := range metrics.Series {
		points := make([]TrafficPoint, 0, len(upstream.Points))
		for _, point := range upstream.Points {
			points = append(points, TrafficPoint{
				T:          point.T,
				Submitted:  count(point.Submitted),
				Delivered:  count(point.Delivered),
				Failed:     count(point.Failed),
				MoReceived: count(point.MoReceived),
			})
		}

		series = append(series, TrafficSeries{Key: upstream.Key, Points: points})
	}

	return GetTrafficMetrics200JSONResponse{
		GroupBy: TrafficGroupBy(metrics.GroupBy),
		Window:  metrics.Window,
		Series:  series,
	}, nil
}

// count lit un compteur absent comme zéro : le contrat ne rend pas les compteurs obligatoires, alors
// qu'une latence ou des sessions absentes disent « non mesuré » et restent nil.
func count(value *int) int {
	if value == nil {
		return 0
	}

	return *value
}
