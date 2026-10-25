import React from 'react';
import { FlexWidget, TextWidget, ImageWidget } from 'react-native-android-widget';
import { LOGO } from './logo';

const C = { bg: '#0B1410', head: '#050A07', card: '#14221B', green: '#4ADE80', lime: '#A3E635', text: '#ECFDF5', muted: '#86A595', danger: '#F87171' };

function Stat({ label, value }) {
  return (
    <FlexWidget style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
      <TextWidget text={label} style={{ fontSize: 10, color: C.muted }} />
      <TextWidget text={String(value)} style={{ fontSize: 15, color: C.text, fontWeight: 'bold' }} />
    </FlexWidget>
  );
}

function Saturation({ pct }) {
  const w = 56;
  return (
    <FlexWidget style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
      <TextWidget text="SATURATION" style={{ fontSize: 10, color: C.muted }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget style={{ width: w, height: 7, borderRadius: 4, backgroundColor: '#1F3328', flexDirection: 'row' }}>
          <FlexWidget style={{ width: Math.max(3, Math.min(w, (w * pct) / 100)), height: 7, borderRadius: 4, backgroundColor: pct > 95 ? C.danger : C.green }} />
        </FlexWidget>
        <TextWidget text={' ' + pct.toFixed(2) + '%'} style={{ fontSize: 13, color: C.text, fontWeight: 'bold' }} />
      </FlexWidget>
    </FlexWidget>
  );
}

export function FrogsWidget({ d, time, error }) {
  return (
    <FlexWidget style={{ width: 'match_parent', height: 'match_parent', backgroundColor: C.bg, borderRadius: 22, flexDirection: 'column' }} clickAction="OPEN_APP">
      {/* header */}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.head, paddingHorizontal: 14, paddingVertical: 10, borderTopLeftRadius: 22, borderTopRightRadius: 22 }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ImageWidget image={LOGO} imageWidth={44} imageHeight={44} />
          <FlexWidget style={{ marginLeft: 10 }}>
            <TextWidget text="Frog Labs" style={{ fontSize: 19, color: C.text, fontWeight: 'bold' }} />
          </FlexWidget>
        </FlexWidget>
        {d ? (
          <FlexWidget style={{ alignItems: 'flex-end' }}>
            <TextWidget text={'EPOCH  ' + d.epoch} style={{ fontSize: 12, color: C.lime, fontWeight: 'bold' }} />
            <TextWidget text={'END  ' + d.endsIn} style={{ fontSize: 12, color: C.text }} />
            <TextWidget text={'BLOCKS  ' + d.networkBlocks} style={{ fontSize: 12, color: C.text }} />
          </FlexWidget>
        ) : null}
      </FlexWidget>

      {error || !d ? (
        <FlexWidget style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <TextWidget text={error ? 'Error: ' + error : 'Loading…'} style={{ fontSize: 13, color: C.danger }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flex: 1, width: 'match_parent', paddingHorizontal: 10, paddingTop: 6 }}>
          <FlexWidget style={{ width: 'match_parent', alignItems: 'center', paddingBottom: 4 }}>
            <TextWidget text={d.ticker} style={{ fontSize: 18, color: C.green, fontWeight: 'bold' }} />
          </FlexWidget>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
            <Stat label="EPOCH BLOCKS" value={d.epochBlocks} />
            <Stat label="DELEGATORS" value={d.delegators} />
            <Saturation pct={d.saturation} />
          </FlexWidget>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
            <Stat label="LIVE STAKE" value={d.liveStake} />
            <Stat label="ACTIVE STAKE" value={d.activeStake} />
            <Stat label="LIVE PLEDGE" value={d.livePledge} />
          </FlexWidget>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
            <Stat label="VAR. FEE" value={d.margin} />
            <Stat label="EPOCH FEE" value={d.fixedFee} />
            <Stat label="DECL. PLEDGE" value={d.declPledge} />
          </FlexWidget>
        </FlexWidget>
      )}

      {/* footer */}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 10 }}>
        <TextWidget text={time || ''} style={{ fontSize: 11, color: C.muted }} />
        <FlexWidget clickAction="REFRESH" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
          <TextWidget text="⟳" style={{ fontSize: 18, color: C.green }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

const P = { outer: '#14221B', up: '#4ADE80', down: '#F87171' };

// 1x1 price widget: coin logo + symbol, price, 24h change. Tap anywhere to refresh.
export function PriceWidget({ d, error }) {
  const up = d ? d.change >= 0 : true;
  return (
    <FlexWidget clickAction="REFRESH" style={{ width: 'match_parent', height: 'match_parent', backgroundColor: P.outer, borderRadius: 18, alignItems: 'center', justifyContent: 'center', padding: 4 }}>
      {error || !d ? (
        <TextWidget text={error ? '⚠ ' + error : 'Loading…'} style={{ fontSize: 10, color: error ? C.danger : C.muted }} />
      ) : (
        <FlexWidget style={{ alignItems: 'center' }}>
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
            <FlexWidget style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
              <ImageWidget image={d.image ? d.image : LOGO} imageWidth={20} imageHeight={20} radius={10} />
            </FlexWidget>
            <TextWidget text={'  ' + (d.symbol || '')} style={{ fontSize: 12, color: C.muted, fontWeight: 'bold' }} />
          </FlexWidget>
          <TextWidget text={d.price} style={{ fontSize: 15, color: C.text, fontWeight: 'bold' }} />
          <TextWidget text={(up ? '+' : '') + d.change.toFixed(2) + '%'} style={{ fontSize: 12, color: up ? P.up : P.down, fontWeight: 'bold' }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

// 1x1 pool widget: pool logo + blocks this epoch, live stake, delegators. Tap anywhere to refresh.
export function PoolMiniWidget({ d, error }) {
  return (
    <FlexWidget clickAction="REFRESH" style={{ width: 'match_parent', height: 'match_parent', backgroundColor: P.outer, borderRadius: 18, alignItems: 'center', justifyContent: 'center', padding: 4 }}>
      {error || !d ? (
        <TextWidget text={error ? '⚠ ' + error : 'Loading…'} style={{ fontSize: 10, color: error ? C.danger : C.muted }} />
      ) : (
        <FlexWidget style={{ alignItems: 'center' }}>
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ImageWidget image={d.logoUrl ? d.logoUrl : LOGO} imageWidth={22} imageHeight={22} radius={11} />
            <TextWidget text={'  ' + d.epochBlocks} style={{ fontSize: 16, color: C.green, fontWeight: 'bold' }} />
          </FlexWidget>
          <TextWidget text={'🪙 ' + d.liveStake} style={{ fontSize: 12, color: C.text, fontWeight: 'bold' }} />
          <TextWidget text={'👥 ' + d.delegators} style={{ fontSize: 12, color: C.text, fontWeight: 'bold' }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
