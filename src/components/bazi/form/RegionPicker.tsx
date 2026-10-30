/**
 * 省市县三级联动选择组件
 *
 * 'use client' 标记说明：
 * - 使用 useState 管理选择状态
 * - 包含交互式下拉选择
 */
'use client';

import { Select } from '@/components/ui/Select';
import { useState, useMemo, useEffect } from 'react';

interface Region {
    name: string;
    children?: Region[];
}

interface RegionPickerProps {
    value: string;
    onChange: (value: string) => void;
}

// 从 JSON 加载地区数据
let regionsCache: Region[] | null = null;

async function loadRegions(): Promise<Region[]> {
    if (regionsCache) return regionsCache;
    const res = await fetch('/data/china-regions.json');
    const data = await res.json();
    regionsCache = data;
    return regionsCache!;
}

export function RegionPicker({ value, onChange }: RegionPickerProps) {
    const [regions, setRegions] = useState<Region[]>([]);

    useEffect(() => {
        void loadRegions().then(setRegions);
    }, []);
    // 解析当前值为省/市/区
    const parseValue = (val: string): [string, string, string] => {
        if (!val) return ['', '', ''];
        const parts = val.split(/[,，\s]+/).filter(Boolean);
        return [parts[0] || '', parts[1] || '', parts[2] || ''];
    };

    const [province, city, district] = parseValue(value);
    const [selectedProvince, setSelectedProvince] = useState(province);
    const [selectedCity, setSelectedCity] = useState(city);
    const [selectedDistrict, setSelectedDistrict] = useState(district);

    // 同步外部值变化（使用条件更新代替 useEffect）
    const [lastValue, setLastValue] = useState(value);
    if (value !== lastValue) {
        const [p, c, d] = parseValue(value);
        setSelectedProvince(p);
        setSelectedCity(c);
        setSelectedDistrict(d);
        setLastValue(value);
    }

    // 获取当前省份的城市列表
    const cities = useMemo(() => {
        if (!selectedProvince) return [];
        const prov = regions.find(r => r.name === selectedProvince);
        return prov?.children || [];
    }, [selectedProvince, regions]);

    // 获取当前城市的区县列表
    const districts = useMemo(() => {
        if (!selectedCity || !cities.length) return [];
        const city = cities.find(c => c.name === selectedCity);
        return city?.children || [];
    }, [selectedCity, cities]);

    // 构建完整地址并通知父组件
    const updateValue = (prov: string, city: string, dist: string) => {
        const parts = [prov, city, dist].filter(Boolean);
        onChange(parts.join(' '));
    };

    // 处理省份变化
    const handleProvinceChange = (prov: string) => {
        setSelectedProvince(prov);
        setSelectedCity('');
        setSelectedDistrict('');
        updateValue(prov, '', '');
    };

    // 处理城市变化
    const handleCityChange = (city: string) => {
        setSelectedCity(city);
        setSelectedDistrict('');
        updateValue(selectedProvince, city, '');
    };

    // 处理区县变化
    const handleDistrictChange = (dist: string) => {
        setSelectedDistrict(dist);
        updateValue(selectedProvince, selectedCity, dist);
    };

    return (
        <div className="grid grid-cols-3 gap-2">
            {/* 省份选择 */}
            <div>
                <label className="mb-1.5 block text-[13px] text-foreground-secondary">省/直辖市</label>
                <Select
                    ariaLabel="省/直辖市"
                    placeholder="省份"
                    value={selectedProvince || null}
                    onChange={handleProvinceChange}
                    options={regions.map(region => ({ value: region.name, label: region.name }))}
                    className="h-11 text-sm"
                />
            </div>

            {/* 城市选择 */}
            <div>
                <label className="mb-1.5 block text-[13px] text-foreground-secondary">市/区</label>
                <Select
                    ariaLabel="市/区"
                    placeholder="城市"
                    value={selectedCity || null}
                    onChange={handleCityChange}
                    disabled={cities.length === 0}
                    options={cities.map(city => ({ value: city.name, label: city.name }))}
                    className="h-11 text-sm"
                />
            </div>

            {/* 区县选择 */}
            <div>
                <label className="mb-1.5 block text-[13px] text-foreground-secondary">区/县</label>
                <Select
                    ariaLabel="区/县"
                    placeholder="区县"
                    value={selectedDistrict || null}
                    onChange={handleDistrictChange}
                    disabled={districts.length === 0}
                    options={districts.map(district => ({ value: district.name, label: district.name }))}
                    className="h-11 text-sm"
                />
            </div>
        </div>
    );
}
