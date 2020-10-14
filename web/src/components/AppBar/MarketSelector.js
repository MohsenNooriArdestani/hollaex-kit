import React, { Component } from 'react';
import { connect } from 'react-redux';
import { object, string, func } from 'prop-types';
import Image from 'components/Image';
import classnames from 'classnames';

import { Slider } from 'components';
import { BASE_CURRENCY, DEFAULT_COIN_DATA } from 'config/constants';
import STRINGS from 'config/localizedStrings';
import withConfig from 'components/ConfigProvider/withConfig';
import { donutFormatPercentage, formatToCurrency, calculatePrice } from 'utils/currency';
import SearchBox from './SearchBox';

class MarketSelector extends Component {

    constructor(props) {
        super(props);

        const { pairs } = this.props;
        const symbols = ['all', ...this.getSymbols(pairs)];
        const selectedTabMenu = symbols[0];

        this.state = {
            symbols,
            selectedTabMenu,
            searchValue: '',
            searchResult: {},
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        const { pairs } = this.props;

        if (
          JSON.stringify(pairs) !==
          JSON.stringify(nextProps.pairs)
        ) {
          const symbols = ['all', ...this.getSymbols(pairs)];
          const selectedTabMenu = symbols[0];
          this.setState({ symbols, selectedTabMenu })
        }
    }

    componentDidMount() {
        document.addEventListener('click', this.onOutsideClick);
    }

    onOutsideClick = ({ target }) => {
      const { triggerId } = this.props;
        const element = document.getElementById(triggerId);
        if (element &&
            target !== element &&
            !element.contains(target)) {
                this.closeAddTabMenu();
        }
    };

    componentWillUnmount() {
        document.removeEventListener('click', this.onOutsideClick);
    }

    tabListMenuItems = () => {
      const { symbols, selectedTabMenu } = this.state;

      return symbols.map((symbol, index) =>
      <div
        key={index}
        className={classnames(
          "app-bar-tab-menu-list",
          "d-flex",
          "align-items-center",
          { 'active-tab': symbol === selectedTabMenu })}
        onClick={() => this.onAddTabClick(symbol)}
      >
        {symbol.toUpperCase()}
      </div>
    )}

    getSymbols = (pairs) => {
        const obj = {};
        Object.entries(pairs).forEach(([key, pair]) => {
            obj[pair.pair_2] = '';
        });

        return Object.keys(obj).map((key) => key);
    }

    onAddTabClick = (symbol) => {
        this.setState({ selectedTabMenu: symbol });
    }

    handleSearch = (_, value) => {
        const { pairs, coins } = this.props;
        if (value) {
            const result = {};
            const searchValue = value.toLowerCase().trim();
            Object.keys(pairs).map(key => {
                const temp = pairs[key];
                const { fullname } = coins[temp.pair_base.toLowerCase()] || DEFAULT_COIN_DATA;
                const cashName = fullname ? fullname.toLowerCase() : '';
                if (key.indexOf(searchValue) !== -1 ||
                    temp.pair_base.indexOf(searchValue) !== -1 ||
                    temp.pair_2.indexOf(searchValue) !== -1 ||
                    cashName.indexOf(searchValue) !== -1) {
                    result[key] = temp;
                }
                return key;
            });
            this.setState({ searchResult: { ...result }, searchValue: value });
        } else {
            this.setState({ searchResult: {}, searchValue: '' });
        }
    };

    onViewMarketsClick = () => {
      this.props.onViewMarketsClick();
      this.closeAddTabMenu()
    }

    closeAddTabMenu = () => {
      this.props.closeAddTabMenu()
      this.setState({
        searchValue: '',
        searchResult: {},
      })
    }

    render() {
        const {
            pairs,
            coins = {},
            tickers = {},
            addTradePairTab,
            triggerId,
            wrapperClassName,
            icons: ICONS,
        } = this.props;

        const { selectedTabMenu, searchValue, searchResult } = this.state;
        const { handleSearch } = this;

        let tabMenu = {};
        if (searchValue) {
            tabMenu = { ...searchResult };
        } else if ( selectedTabMenu === 'all') {
          Object.keys(pairs).map(key => {
            let temp = pairs[key];
            if (temp) {
              tabMenu[key] = temp;
            }
            return key;
          });
        } else {
            Object.keys(pairs).map(key => {
                let temp = pairs[key];
                if (temp && temp.pair_2 === selectedTabMenu) {
                    tabMenu[key] = temp;
                }
                return key;
            });
        }

        const tabMenuLength = Object.keys(tabMenu).length;
        const hasTabMenu = tabMenuLength !== 0;

        let processedTabMenu = [];
        if (hasTabMenu) {
          processedTabMenu = Object.keys(tabMenu)
            .map((pair) => {
              let menu = tabMenu[pair] || {};
              let ticker = tickers[pair] || {};
              let { symbol = '' } = coins[menu.pair_base || BASE_CURRENCY] || DEFAULT_COIN_DATA;
              let pairTwo = coins[menu.pair_2 || BASE_CURRENCY] || DEFAULT_COIN_DATA;
              const { increment_price } = menu;
              const priceDifference = ticker.open === 0 ? 0 : ((ticker.close || 0) - (ticker.open || 0));
              const tickerPercent = priceDifference === 0 || ticker.open === 0 ? 0 : ((priceDifference / ticker.open) * 100);
              const priceDifferencePercent = isNaN(tickerPercent)
                ? donutFormatPercentage(0)
                : donutFormatPercentage(tickerPercent);

              const volumePrice = calculatePrice(ticker.volume, symbol)

              return ({
                pair,
                symbol,
                menu,
                pairTwo,
                ticker,
                increment_price,
                priceDifference,
                priceDifferencePercent,
                volumePrice
              })
            })
            .sort(({ volumePrice: volumePriceA }, { volumePrice: volumePriceB }) => {
              return volumePriceB - volumePriceA;
            })
            .slice(0, Math.min(tabMenuLength, 10))
        }

        return (
            <div
              id={triggerId}
              className={classnames(
                "app-bar-add-tab-menu",
                wrapperClassName
              )}
            >
                <div className="app-bar-tab-menu">
                    <Slider small>
                      {this.tabListMenuItems()}
                    </Slider>
                    {/*<div className="d-flex align-items-center mr-2">*/}
                      {/*<Image*/}
                        {/*icon={ICONS.TAB_SETTING}*/}
                        {/*wrapperClassName="app-bar-tab-setting"*/}
                      {/*/>*/}
                    {/*</div>*/}
                </div>
                <div className="app-bar-add-tab-content">
                    <div className="app-bar-add-tab-search">
                        <SearchBox
                            name={STRINGS["SEARCH_TXT"]}
                            placeHolder={`${STRINGS["SEARCH_TXT"]}...`}
                            className='app-bar-search-field'
                            handleSearch={handleSearch} />
                    </div>
                    {hasTabMenu
                        ? processedTabMenu.map(({ pair, symbol, menu, pairTwo, ticker, increment_price, priceDifference, priceDifferencePercent }, index) => {
                            return (
                                <div
                                    key={index}
                                    className="app-bar-add-tab-content-list d-flex align-items-center justify-content-between"
                                    onClick={() => addTradePairTab(pair)}
                                >
                                    <div className="d-flex align-items-center">
                                        <Image
                                          iconId={
                                            ICONS[`${menu.pair_base.toUpperCase()}_ICON`]
                                              ? `${menu.pair_base.toUpperCase()}_ICON`
                                              : "DEFAULT_ICON"
                                          }
                                          icon={
                                            ICONS[`${menu.pair_base.toUpperCase()}_ICON`]
                                              ? ICONS[`${menu.pair_base.toUpperCase()}_ICON`]
                                              : ICONS.DEFAULT_ICON
                                          }
                                          wrapperClassName="app-bar-add-tab-icons" />
                                        <div className="app_bar-pair-font">
                                          {symbol.toUpperCase()}/{pairTwo.symbol.toUpperCase()}:
                                        </div>
                                        <div className="title-font ml-1 app-bar_add-tab-price">
                                          {formatToCurrency(ticker.close, increment_price)}
                                        </div>
                                    </div>
                                    <div className="d-flex align-items-center mr-4">
                                        <div
                                          className={
                                            priceDifference < 0
                                              ? "app-price-diff-down app-bar-price_diff_down"
                                              : "app-bar-price_diff_up app-price-diff-up"
                                          }>
                                          {/* {formatAverage(formatToCurrency(priceDifference, increment_price))} */}
                                        </div>
                                        <div
                                          className={priceDifference < 0
                                            ? "title-font app-price-diff-down" : "title-font app-price-diff-up"}>
                                          {priceDifferencePercent}
                                        </div>
                                    </div>
                                </div>
                            )
                        }
                        )
                        : <div className="app-bar-add-tab-content-list d-flex align-items-center">
                            No data...
                        </div>
                    }
                    <div className="d-flex justify-content-center app_bar-link blue-link">
                        <div onClick={this.onViewMarketsClick}>
                          {`view markets`}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

MarketSelector.propTypes = {
  triggerId: string.isRequired,
  pairs: object.isRequired,
  coins: object.isRequired,
  tickers: object.isRequired,
  onViewMarketsClick: func,
  addTradePairTab: func,
  closeAddTabMenu: func,
  wrapperClassName: string,
}

MarketSelector.defaultProps = {
  addTradePairTab: () => {},
  closeAddTabMenu: () => {},
  onViewMarketsClick: () => {},
  wrapperClassName: '',
}


const mapStateToProps = ({ app: { pairs, tickers, coins } }) => ({
  pairs,
  tickers,
  coins,
});

export default connect(mapStateToProps)(withConfig(MarketSelector));