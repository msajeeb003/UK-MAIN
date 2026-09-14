"use client";

import { useEffect, useState } from "react";

import { insurersApi, type Insurer } from "@/lib/api";

/**
 * Fallback standing list, used only until GET /insurers answers (or if it
 * fails). The live list is configuration served by the backend from
 * backend/config/insurers.json — edit it there, not here.
 */
export const FALLBACK_INSURERS: Insurer[] = [
  { id: "allianz", name: "Allianz Trade", debt_collection: "included" },
  { id: "atradius", name: "Atradius", debt_collection: "included" },
  { id: "coface", name: "Coface", debt_collection: "included" },
  { id: "tmhcc", name: "Tokio Marine HCC", debt_collection: "outsourced" },
  { id: "qbe", name: "QBE", debt_collection: "outsourced" },
  { id: "aig", name: "AIG", debt_collection: "outsourced" },
  { id: "chubb", name: "Chubb", debt_collection: "outsourced" },
  { id: "markel", name: "Markel", debt_collection: "outsourced" },
  { id: "nexus", name: "Nexus", debt_collection: "outsourced" },
  { id: "aviva", name: "Aviva", debt_collection: "outsourced" },
  { id: "zurich", name: "Zurich", debt_collection: "outsourced" },
  { id: "cartan", name: "Cartan", debt_collection: "outsourced" },
];

export interface InsurersState {
  insurers: Insurer[];
  /** True while the live list is still loading. */
  loading: boolean;
  /** True when the fallback is in use because the request failed. */
  stale: boolean;
}

export function useInsurers(): InsurersState {
  const [state, setState] = useState<InsurersState>({
    insurers: FALLBACK_INSURERS,
    loading: true,
    stale: false,
  });

  useEffect(() => {
    let cancelled = false;
    insurersApi.list().then(
      (list) => {
        if (cancelled) return;
        setState({
          insurers: list.length ? list : FALLBACK_INSURERS,
          loading: false,
          stale: !list.length,
        });
      },
      () => {
        if (!cancelled) setState({ insurers: FALLBACK_INSURERS, loading: false, stale: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
